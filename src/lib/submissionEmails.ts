// Automatische E-Mails nach Formularabschluss.
//
// Bei der Einreichung laufen zwei mögliche Mails:
//
//   1. Bestätigungs-E-Mail (template.email_config.confirmation.enabled):
//      Geht an Self/Fahrer/Extra-Empfänger. Anhänge sind optional.
//
//   2. Schieberegler-E-Mails (template.email_config.sliders.enabled):
//      Pro aktivem Schieberegler eine separate Mail an die vom Fahrer
//      eingetragene Adresse, mit den im Template konfigurierten PDFs.
//
// Beide Pfade arbeiten unabhängig — schlägt einer fehl, läuft der andere
// trotzdem. Das Ergebnis wird pro Versuch in `ausgefuellte_formulare
// .email_send_log` persistiert, damit der Admin in Eingänge nachvollziehen
// kann, ob die Mails rausgingen.

import { supabase } from './supabase';
import { sendEmail } from './onedrive';
import {
  generateAndUploadFormPdfs, resolvePattern, type GeneratedPdf,
} from './pdfGenerate';
import type {
  AusgefuelltesFormular, EmailSendLogEntry, FormularTemplate,
} from '../types/db';
import type { Json } from '../types/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SLIDER_KEYS = ['_slider_0', '_slider_1'] as const;

export interface SliderState {
  enabled: boolean;
  email: string;
}

/** Liest den Schieberegler-State aus `daten`. */
export function readSliderState(
  daten: Record<string, unknown>, index: 0 | 1,
): SliderState {
  const raw = daten[SLIDER_KEYS[index]];
  if (!raw || typeof raw !== 'object') return { enabled: false, email: '' };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    email: typeof o.email === 'string' ? o.email : '',
  };
}

export function sliderKey(index: 0 | 1): string {
  return SLIDER_KEYS[index];
}

function splitList(s: string): string[] {
  return s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    const k = e.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e.trim());
  }
  return out;
}

interface RunOptions {
  /** E-Mail des einreichenden Fahrers — für Bestätigungs-Self-CC. */
  submitterEmail?: string | null;
  /** Optionale Fahrer-E-Mail (für confirmation.recipient_fahrer). */
  fahrerEmail?: string | null;
  /** Anzeigename des Fahrers — für `{fahrer_name}`-Platzhalter. */
  fahrerName?: string | null;
}

/**
 * Reichert `daten` um abgeleitete Platzhalter an, die nicht aus dem
 * Schema kommen (z.B. `{template_name}`, `{datum}`, `{fahrer_name}`).
 * Schema-Felder gewinnen — der Admin kann sie via gleichnamigem Feld
 * überschreiben.
 */
function enrich(
  daten: Record<string, unknown>,
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  options: RunOptions,
): Record<string, unknown> {
  const derived: Record<string, unknown> = {
    template_name: template.name,
    datum: formatGermanDate(formular.created_at),
  };
  if (options.fahrerName) derived.fahrer_name = options.fahrerName;
  return { ...derived, ...daten };
}

function formatGermanDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * Führt alle automatischen E-Mails nach erfolgreichem Submit aus und
 * persistiert das Ergebnis in `ausgefuellte_formulare.email_send_log`.
 * Gibt das aggregierte Log zurück.
 */
export async function runSubmissionEmails(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  options: RunOptions = {},
): Promise<EmailSendLogEntry[]> {
  const cfg = template.email_config;
  // Diagnose-Log: zeigt im Fehlerfall sofort, OB die Routine läuft und
  // ob die Template-E-Mail-Konfiguration überhaupt mitgeladen wurde.
  console.log('[Einreichung] Versand-Routine gestartet', {
    formularId: formular.id,
    templateId: template.id,
    emailConfig: cfg
      ? {
          confirmationEnabled: cfg.confirmation?.enabled ?? false,
          slidersEnabled: cfg.sliders?.enabled ?? false,
          sliderCount: cfg.sliders?.count ?? 0,
        }
      : null,
    schiebereglerAktiv: ([0, 1] as const).map((i) => {
      const s = readSliderState(formular.daten as Record<string, unknown>, i);
      return { index: i, enabled: s.enabled, email: s.email };
    }),
  });
  if (!cfg) return [];

  const log: EmailSendLogEntry[] = [];

  // Die drei Mail-Arten (Bestätigung, Schieberegler 0, Schieberegler 1)
  // laufen unabhängig: ein unerwarteter Crash in einem Block darf die
  // anderen NICHT verhindern — und nie die Einreichung selbst.

  // ---- 1. Bestätigungs-E-Mail -------------------------------------
  if (cfg.confirmation?.enabled) {
    try {
      const entry = await runConfirmation(template, formular, options);
      if (entry) log.push(entry);
    } catch (err) {
      console.warn('[Einreichung] Bestätigungs-Mail unerwartet fehlgeschlagen', err);
      log.push({
        type: 'confirmation', recipients: [],
        sent_at: new Date().toISOString(), success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- 2. Schieberegler-E-Mails -----------------------------------
  if (cfg.sliders?.enabled) {
    const count = cfg.sliders.count;
    const wanted = cfg.sliders.attach_pdf_ids ?? [];
    // PDFs werden EINMAL erzeugt, dann an alle aktiven Schieberegler
    // angehängt — alle Schieberegler teilen sich dieselbe Anhang-Liste.
    let generated: GeneratedPdf[] | null = null;
    let pdfError: string | null = null;
    const indexes: (0 | 1)[] = count === 2 ? [0, 1] : [0];
    const activeIndexes = indexes.filter((i) => {
      const s = readSliderState(formular.daten as Record<string, unknown>, i);
      return s.enabled && EMAIL_RE.test(s.email.trim());
    });

    if (activeIndexes.length > 0 && wanted.length > 0) {
      try {
        generated = await generateAndUploadFormPdfs(template, formular, wanted);
      } catch (err) {
        pdfError = err instanceof Error ? err.message : String(err);
        console.warn('[runSubmissionEmails] Schieberegler-PDF-Generierung fehlgeschlagen', err);
      }
    }

    for (const idx of activeIndexes) {
      const state = readSliderState(formular.daten as Record<string, unknown>, idx);
      try {
        const entry = await runSlider(template, formular, idx, state, generated, pdfError, options);
        log.push(entry);
      } catch (err) {
        console.warn(`[Einreichung] Schieberegler-Mail ${idx} unerwartet fehlgeschlagen`, err);
        log.push({
          type: 'slider', slider_index: idx, recipients: [state.email.trim()],
          sent_at: new Date().toISOString(), success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ---- Log persistieren -------------------------------------------
  if (log.length > 0) {
    try {
      // Bestehendes Log NICHT überschreiben — wir lesen es zuerst und hängen an.
      const { data: existing } = await supabase
        .from('ausgefuellte_formulare')
        .select('email_send_log')
        .eq('id', formular.id)
        .maybeSingle();
      const prev = Array.isArray(existing?.email_send_log)
        ? (existing!.email_send_log as unknown as EmailSendLogEntry[])
        : [];
      await supabase
        .from('ausgefuellte_formulare')
        .update({ email_send_log: [...prev, ...log] as unknown as Json })
        .eq('id', formular.id);
    } catch (err) {
      console.warn('[runSubmissionEmails] email_send_log konnte nicht gespeichert werden', err);
    }
  }

  return log;
}

/**
 * Zwischenprotokoll-E-Mail (Vorlage 4). Wird NICHT beim Formularabschluss
 * ausgelöst, sondern beim "Zwischenprotokoll abschließen" — separat von
 * runSubmissionEmails, damit der finale Abschluss unverändert bleibt.
 * Läuft im Hintergrund; Fehler landen im email_send_log statt den
 * Fahrer zu blockieren.
 */
export async function runZwischenprotokollEmail(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  options: RunOptions = {},
): Promise<EmailSendLogEntry | null> {
  const cfg = template.email_config?.zwischenprotokoll;
  if (!cfg?.enabled) return null;
  const data = enrich(formular.daten as Record<string, unknown>, template, formular, options);

  const to: string[] = [];
  if (cfg.recipient_fahrer && options.fahrerEmail && EMAIL_RE.test(options.fahrerEmail)) {
    to.push(options.fahrerEmail);
  }
  if (cfg.recipient_self && options.submitterEmail && EMAIL_RE.test(options.submitterEmail)) {
    to.push(options.submitterEmail);
  }
  for (const raw of splitList(resolvePattern(cfg.recipient_extra ?? '', data))) {
    if (EMAIL_RE.test(raw)) to.push(raw);
  }
  const recipients = dedupe(to);
  const now = () => new Date().toISOString();
  if (recipients.length === 0) {
    return {
      type: 'zwischenprotokoll', recipients: [], sent_at: now(),
      success: false, error: 'Keine Empfänger konfiguriert / auflösbar.',
    };
  }

  // Anhänge: die im Template gewählten PDF-Vorlagen (z.B. Protokoll-Teil
  // + Fotos Übernahme). generateAndUploadFormPdfs respektiert dabei die
  // "PDFs zusammenführen"-Option und liefert dann EINE Datei.
  let attachments: Array<{ name: string; contentType: string; onedrive_path: string }> = [];
  if (cfg.attach_pdf_ids && cfg.attach_pdf_ids.length > 0) {
    try {
      const generated = await generateAndUploadFormPdfs(template, formular, cfg.attach_pdf_ids);
      attachments = generated.map((g) => ({
        name: g.filename, contentType: 'application/pdf', onedrive_path: g.onedrive_path,
      }));
    } catch (err) {
      console.warn('[Zwischenprotokoll] PDF-Erzeugung für Anhänge fehlgeschlagen', err);
    }
  }

  const subject = resolvePattern(cfg.subject ?? '', data) || `Zwischenprotokoll — ${template.name}`;
  const body = resolvePattern(cfg.body ?? '', data);
  try {
    const result = await sendEmail({
      to: recipients, subject, body,
      from: cfg.from || undefined,
      attachments,
      formular_id: formular.id,
    });
    console.log('[Zwischenprotokoll] Mail-Versand Response', {
      empfaenger: recipients, attached: result.attached, missing: result.missing,
    });
    return { type: 'zwischenprotokoll', recipients, sent_at: now(), success: true };
  } catch (err) {
    console.warn('[Zwischenprotokoll] Mail-Versand fehlgeschlagen', err);
    return {
      type: 'zwischenprotokoll', recipients, sent_at: now(), success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Hängt einen Log-Eintrag an ausgefuellte_formulare.email_send_log an. */
export async function appendEmailLog(
  formularId: string, entries: EmailSendLogEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const { data: existing } = await supabase
      .from('ausgefuellte_formulare')
      .select('email_send_log')
      .eq('id', formularId)
      .maybeSingle();
    const prev = Array.isArray(existing?.email_send_log)
      ? (existing!.email_send_log as unknown as EmailSendLogEntry[])
      : [];
    await supabase
      .from('ausgefuellte_formulare')
      .update({ email_send_log: [...prev, ...entries] as unknown as Json })
      .eq('id', formularId);
  } catch (err) {
    console.warn('[appendEmailLog] konnte nicht gespeichert werden', err);
  }
}

async function runConfirmation(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  options: RunOptions,
): Promise<EmailSendLogEntry | null> {
  const cfg = template.email_config!.confirmation!;
  const data = enrich(formular.daten as Record<string, unknown>, template, formular, options);

  const to: string[] = [];
  if (cfg.recipient_fahrer && options.fahrerEmail && EMAIL_RE.test(options.fahrerEmail)) {
    to.push(options.fahrerEmail);
  }
  if (cfg.recipient_self && options.submitterEmail && EMAIL_RE.test(options.submitterEmail)) {
    to.push(options.submitterEmail);
  }
  for (const raw of splitList(resolvePattern(cfg.recipient_extra ?? '', data))) {
    if (EMAIL_RE.test(raw)) to.push(raw);
  }
  const recipients = dedupe(to);

  if (recipients.length === 0) {
    return {
      type: 'confirmation',
      recipients: [],
      sent_at: new Date().toISOString(),
      success: false,
      error: 'Keine Empfänger konfiguriert / auflösbar.',
    };
  }

  const subject = resolvePattern(cfg.subject ?? '', data) || template.name;
  const body = resolvePattern(cfg.body ?? '', data);

  // Optionale Anhänge: nur wenn explizit konfiguriert.
  let attachments: Array<{ name: string; contentType: string; onedrive_path: string }> = [];
  if (cfg.attach_pdf_ids && cfg.attach_pdf_ids.length > 0) {
    try {
      const generated = await generateAndUploadFormPdfs(template, formular, cfg.attach_pdf_ids);
      attachments = generated.map((g) => ({
        name: g.filename,
        contentType: 'application/pdf',
        onedrive_path: g.onedrive_path,
      }));
    } catch (err) {
      // PDF-Fehler → Mail trotzdem ohne Anhang versenden, Fehler im Log.
      console.warn('[runSubmissionEmails] Confirmation-PDF-Generierung fehlgeschlagen', err);
    }
  }

  try {
    const result = await sendEmail({
      to: recipients,
      subject,
      body,
      from: cfg.from || undefined,
      attachments,
      formular_id: formular.id,
    });
    console.log('[Einreichung] Mail-Versand Response', {
      type: 'confirmation', empfaenger: recipients,
      attached: result.attached, missing: result.missing,
    });
    return {
      type: 'confirmation',
      recipients,
      sent_at: new Date().toISOString(),
      success: true,
    };
  } catch (err) {
    console.warn('[Einreichung] Mail-Versand Response', {
      type: 'confirmation', empfaenger: recipients,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      type: 'confirmation',
      recipients,
      sent_at: new Date().toISOString(),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runSlider(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  idx: 0 | 1,
  state: SliderState,
  generated: GeneratedPdf[] | null,
  pdfError: string | null,
  options: RunOptions,
): Promise<EmailSendLogEntry> {
  const cfg = template.email_config!.sliders!;
  const data = enrich(formular.daten as Record<string, unknown>, template, formular, options);
  const recipient = state.email.trim();

  if (pdfError) {
    return {
      type: 'slider',
      slider_index: idx,
      recipients: [recipient],
      sent_at: new Date().toISOString(),
      success: false,
      error: `PDF-Generierung fehlgeschlagen: ${pdfError}`,
    };
  }

  const subject = resolvePattern(cfg.subject ?? '', data) || template.name;
  const body = resolvePattern(cfg.body ?? '', data);
  const attachments = (generated ?? []).map((g) => ({
    name: g.filename,
    contentType: 'application/pdf',
    onedrive_path: g.onedrive_path,
  }));

  try {
    const result = await sendEmail({
      to: [recipient],
      subject,
      body,
      from: cfg.from || undefined,
      attachments,
      formular_id: formular.id,
    });
    console.log('[Einreichung] Mail-Versand Response', {
      type: 'slider', sliderIndex: idx, empfaenger: [recipient],
      attached: result.attached, missing: result.missing,
    });
    return {
      type: 'slider',
      slider_index: idx,
      recipients: [recipient],
      sent_at: new Date().toISOString(),
      success: true,
    };
  } catch (err) {
    console.warn('[Einreichung] Mail-Versand Response', {
      type: 'slider', sliderIndex: idx, empfaenger: [recipient],
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      type: 'slider',
      slider_index: idx,
      recipients: [recipient],
      sent_at: new Date().toISOString(),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
