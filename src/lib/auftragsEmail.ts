// Auftrags-E-Mail an den Fahrer (Migration 082).
//
// Vorlage (Absender, Betreff, Body) liegt in app_settings unter
// `auftrags_email` und ist in den Einstellungen pflegbar.
//
// WICHTIG: Die Auftraggeber-Vergütung ist bewusst KEIN Platzhalter —
// der Fahrer bekommt sie nicht zu sehen. Das Fahrer-Honorar ist
// erlaubt, weil es ihn selbst betrifft.

import { supabase } from './supabase';
import { formatDate } from './touren';
import { ladeAnsprechpartner, STATIONEN, type Station } from './tourAnsprechpartner';
import type { Json } from '../types/supabase';

const KEY = 'auftrags_email';

export interface AuftragsEmailVorlage {
  /** Mailbox-Key (mail_inbox_1 = info@, mail_inbox_2 = protokollierung@). */
  from: 'mail_inbox_1' | 'mail_inbox_2';
  subject: string;
  body: string;
}

export const DEFAULT_AUFTRAGS_EMAIL: AuftragsEmailVorlage = {
  from: 'mail_inbox_1',
  subject: 'Fahrauftrag {tour_id} — {stadt_start} nach {stadt_ziel} am {startdatum}',
  body: [
    'Hallo {fahrer_name},',
    '',
    'anbei dein Fahrauftrag:',
    '',
    'Auftrag: {tour_id}',
    'Auftraggeber: {auftraggeber}',
    'Kunde: {kundenname}',
    'Tourenart: {tourenart}',
    '',
    'FAHRZEUG',
    'Kennzeichen: {kennzeichen}',
    'Modell: {fahrzeugmodell}',
    'FIN: {fin}',
    'Kennzeichen Rück: {kennzeichen_rueck}',
    'Modell Rück: {fahrzeugmodell_rueck}',
    'FIN Rück: {fin_rueck}',
    '',
    'ABHOLUNG — {stadt_start}, {startdatum}',
    'Zeit: {zeit_start}',
    'Adresse: {adresse_start}',
    'Ansprechpartner: {kontakt_start}',
    '',
    'ABGABE — {stadt_ziel}, {enddatum}',
    'Zeit: {zeit_ziel}',
    'Adresse: {adresse_ziel}',
    'Ansprechpartner: {kontakt_ziel}',
    '',
    'RÜCKFÜHRUNG — {stadt_rueckfuehrung}',
    'Zeit: {zeit_rueckfuehrung}',
    'Adresse: {adresse_rueckfuehrung}',
    'Ansprechpartner: {kontakt_rueckfuehrung}',
    '',
    'Hinweise: {info}',
    'Honorar: {fahrer_honorar}',
    '',
    'Bitte kurz bestätigen. Danke!',
  ].join('\n'),
};

/** Klickbare Chips im Vorlagen-Editor. */
export const AUFTRAGS_PLATZHALTER: Array<{ token: string; label: string }> = [
  { token: '{tour_id}', label: 'Tour-Nummer' },
  { token: '{auftraggeber}', label: 'Auftraggeber' },
  { token: '{kundenname}', label: 'Kundenname' },
  { token: '{tourenart}', label: 'Tourenart' },
  { token: '{fahrer_name}', label: 'Fahrer' },
  { token: '{fahrer_honorar}', label: 'Fahrer-Honorar' },
  { token: '{startdatum}', label: 'Startdatum' },
  { token: '{enddatum}', label: 'Enddatum' },
  { token: '{stadt_start}', label: 'Stadt Start' },
  { token: '{stadt_ziel}', label: 'Stadt Ziel' },
  { token: '{stadt_rueckfuehrung}', label: 'Stadt Rückführung' },
  { token: '{zeit_start}', label: 'Zeit Start' },
  { token: '{zeit_ziel}', label: 'Zeit Ziel' },
  { token: '{zeit_rueckfuehrung}', label: 'Zeit Rückführung' },
  { token: '{adresse_start}', label: 'Adresse Start' },
  { token: '{adresse_ziel}', label: 'Adresse Ziel' },
  { token: '{adresse_rueckfuehrung}', label: 'Adresse Rückführung' },
  // Migration 086 — Adressteile zusätzlich einzeln mappbar. Die
  // zusammengesetzten {adresse_*} bleiben unverändert erhalten.
  { token: '{strasse_start}', label: 'Straße Start' },
  { token: '{plz_start}', label: 'PLZ Start' },
  { token: '{strasse_ziel}', label: 'Straße Ziel' },
  { token: '{plz_ziel}', label: 'PLZ Ziel' },
  { token: '{strasse_rueckfuehrung}', label: 'Straße Rückführung' },
  { token: '{plz_rueckfuehrung}', label: 'PLZ Rückführung' },
  { token: '{kontakt_start}', label: 'Ansprechpartner Start' },
  { token: '{kontakt_ziel}', label: 'Ansprechpartner Ziel' },
  { token: '{kontakt_rueckfuehrung}', label: 'Ansprechpartner Rückführung' },
  { token: '{kennzeichen}', label: 'Kennzeichen' },
  { token: '{kennzeichen_rueck}', label: 'Kennzeichen Rück' },
  { token: '{fin}', label: 'FIN' },
  { token: '{fin_rueck}', label: 'FIN Rück' },
  { token: '{fahrzeugmodell}', label: 'Fahrzeugmodell' },
  { token: '{fahrzeugmodell_rueck}', label: 'Fahrzeugmodell Rück' },
  { token: '{info}', label: 'Hinweise' },
];

export function parseAuftragsEmail(raw: unknown): AuftragsEmailVorlage {
  if (!raw || typeof raw !== 'object') return DEFAULT_AUFTRAGS_EMAIL;
  const o = raw as Record<string, unknown>;
  const from = o.from === 'mail_inbox_2' ? 'mail_inbox_2' : 'mail_inbox_1';
  return {
    from,
    subject: typeof o.subject === 'string' && o.subject.trim()
      ? o.subject : DEFAULT_AUFTRAGS_EMAIL.subject,
    body: typeof o.body === 'string' && o.body.trim()
      ? o.body : DEFAULT_AUFTRAGS_EMAIL.body,
  };
}

export async function loadAuftragsEmail(): Promise<AuftragsEmailVorlage> {
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) {
    console.warn('[auftragsEmail.load]', error.message);
    return DEFAULT_AUFTRAGS_EMAIL;
  }
  return parseAuftragsEmail(data?.value ?? null);
}

export async function saveAuftragsEmail(v: AuftragsEmailVorlage): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: KEY, value: v as unknown as Json }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

// ---- Auflösung -----------------------------------------------------

/** Tour-Felder, die für die Auftrags-Mail gebraucht werden. */
export interface AuftragsTour {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  adresse_start: string | null;
  strasse_start?: string | null;
  plz_start?: string | null;
  strasse_ziel?: string | null;
  plz_ziel?: string | null;
  strasse_rueckfuehrung?: string | null;
  plz_rueckfuehrung?: string | null;
  adresse_ziel: string | null;
  adresse_rueckfuehrung: string | null;
  zeit_start: string | null;
  zeit_ziel: string | null;
  zeit_rueckfuehrung: string | null;
  startdatum: string | null;
  enddatum: string | null;
  tourenart: string | null;
  kennzeichen: string[] | null;
  fin: string | null;
  fin_rueck: string | null;
  fahrzeugmodell: string | null;
  fahrzeugmodell_rueck: string | null;
  kundenname: string | null;
  info: string | null;
  fahrer_honorar: number | null;
}

function kontaktText(liste: Array<{ name: string; telefon: string; email: string }>): string {
  const gefuellt = liste
    .map((k) => [k.name, k.telefon, k.email].map((x) => x.trim()).filter(Boolean).join(', '))
    .filter(Boolean);
  return gefuellt.join(' | ');
}

function euro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return `${Number(n).toFixed(2).replace('.', ',')} €`;
}

/**
 * Baut die Platzhalter-Werte. Alle Ansprechpartner einer Station werden
 * zusammengefasst — auch die zusätzlichen aus tour_ansprechpartner.
 */
export async function buildPlatzhalter(
  tour: AuftragsTour,
  extras: { fahrerName?: string | null; auftraggeberName?: string | null },
): Promise<Record<string, string>> {
  const kontakte = await ladeAnsprechpartner(tour.id);
  const kText: Record<Station, string> = {
    start: '', ziel: '', rueckfuehrung: '',
  };
  for (const st of STATIONEN) kText[st] = kontaktText(kontakte[st]);

  return {
    tour_id: tour.tour_id ?? '',
    auftraggeber: extras.auftraggeberName ?? '',
    kundenname: tour.kundenname ?? '',
    tourenart: tour.tourenart ?? '',
    fahrer_name: extras.fahrerName ?? '',
    fahrer_honorar: euro(tour.fahrer_honorar),
    startdatum: tour.startdatum ? formatDate(tour.startdatum) : '',
    enddatum: tour.enddatum ? formatDate(tour.enddatum) : '',
    stadt_start: tour.start_stadt ?? '',
    stadt_ziel: tour.ziel_stadt ?? '',
    stadt_rueckfuehrung: tour.rueckfuehrung_stadt ?? '',
    zeit_start: tour.zeit_start ?? '',
    zeit_ziel: tour.zeit_ziel ?? '',
    zeit_rueckfuehrung: tour.zeit_rueckfuehrung ?? '',
    adresse_start: tour.adresse_start ?? '',
    strasse_start: tour.strasse_start ?? '',
    plz_start: tour.plz_start ?? '',
    strasse_ziel: tour.strasse_ziel ?? '',
    plz_ziel: tour.plz_ziel ?? '',
    strasse_rueckfuehrung: tour.strasse_rueckfuehrung ?? '',
    plz_rueckfuehrung: tour.plz_rueckfuehrung ?? '',
    adresse_ziel: tour.adresse_ziel ?? '',
    adresse_rueckfuehrung: tour.adresse_rueckfuehrung ?? '',
    kontakt_start: kText.start,
    kontakt_ziel: kText.ziel,
    kontakt_rueckfuehrung: kText.rueckfuehrung,
    kennzeichen: tour.kennzeichen?.[0] ?? '',
    kennzeichen_rueck: tour.kennzeichen?.[1] ?? '',
    fin: tour.fin ?? '',
    fin_rueck: tour.fin_rueck ?? '',
    fahrzeugmodell: tour.fahrzeugmodell ?? '',
    fahrzeugmodell_rueck: tour.fahrzeugmodell_rueck ?? '',
    info: tour.info ?? '',
  };
}

/**
 * Setzt die Platzhalter ein. Damit die E-Mail „clean" bleibt:
 *   * Eine Zeile, die NUR aus Label + leerem Platzhalter besteht
 *     ("Modell Rück: {fahrzeugmodell_rueck}"), fällt komplett weg.
 *   * Ein Abschnitt, dessen Zeilen dadurch alle wegfallen, hinterlässt
 *     keine leere Überschrift.
 *   * Mehr als eine Leerzeile am Stück wird zusammengezogen.
 * Unbekannte Platzhalter werden zu Leerstring, nie zu "undefined".
 */
export function resolveAuftragsText(
  vorlage: string, werte: Record<string, string>,
): string {
  const zeilen = vorlage.split(/\r?\n/);
  const out: string[] = [];

  for (const zeile of zeilen) {
    const tokens = zeile.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
    const ersetzt = zeile.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, k: string) => werte[k] ?? '');
    // Zeile hatte Platzhalter, nach dem Ersetzen bleibt aber nur noch
    // Beiwerk (Label, Doppelpunkt, Bindestrich) übrig → weglassen.
    if (tokens.length > 0) {
      const alleLeer = tokens.every((t) => !(werte[t.slice(1, -1)] ?? '').trim());
      if (alleLeer) continue;
    }
    out.push(ersetzt.replace(/[ \t]+$/, ''));
  }

  // Überschriften ohne Inhalt entfernen: eine Zeile in GROSSBUCHSTABEN
  // bzw. mit "—", auf die direkt eine Leerzeile oder das Ende folgt.
  const gefiltert: string[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const z = out[i];
    const naechste = out[i + 1];
    const istUeberschrift = /^[A-ZÄÖÜ][A-ZÄÖÜ —-]*$/.test(z.trim()) && z.trim().length > 2;
    if (istUeberschrift && (naechste === undefined || naechste.trim() === '')) continue;
    gefiltert.push(z);
  }

  return gefiltert
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
