import {
  useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent,
} from 'react';
import { sendEmail } from '../../lib/onedrive';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useTestGuard } from '../../auth/TestModeContext';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../lib/emailSignature';
import { XIcon } from '../../components/icons';
import {
  asPdfPathList, expectedOneDrivePath, resolveFilename, resolvePattern,
} from '../../lib/pdfGenerate';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import type {
  AusgefuelltesFormular, EmailFavorit, FormularTemplate,
} from '../../types/db';

interface Props {
  formular: AusgefuelltesFormular;
  template: FormularTemplate;
  onClose: () => void;
  onSent: () => void;
}

interface AttachmentDraft {
  id: string;
  name: string;
  filename: string;
  onedrive_path: string;
  selected: boolean;
}

interface EmailOption {
  email: string;
  name: string | null;
  /** Quelle, nur zur Anzeige / Sortierung. */
  source: 'favorit' | 'auftraggeber' | 'zuletzt';
  /** Datensatz aus email_favoriten, falls vorhanden — für Stern-Toggle. */
  favoritId?: string;
  /** Ist als Favorit markiert (kommt entweder aus DB oder aus reinem Favoriten-Eintrag). */
  ist_favorit: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Manuelle Anhänge ------------------------------------------------
// Erlaubte gängige Anhang-Typen: PDF, Bilder, Office-Dokumente.
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'];
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png';
// Grenzen: manuelle Dateien reisen als base64 IM JSON-Body der Vercel-
// Function (~4,5 MB Limit) und gehen inline an Graph sendMail (~4 MB pro
// Nachricht). base64 bläht ~+37 % auf. Die generierten PDFs werden dagegen
// serverseitig per onedrive_path geladen und zählen NICHT zum Body. Daher
// für die manuellen Dateien ein konservatives, zuverlässig sendbares
// Budget (statt der nicht transportierbaren 10–15 MB).
const MAX_FILE_BYTES = 3 * 1024 * 1024;   // 3 MB pro Datei
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;  // 3 MB gesamt (manuell)

interface ManualFile { id: string; file: File }

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  return ALLOWED_MIME.has(file.type) || ALLOWED_EXT.includes(fileExt(file.name));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Liest eine Datei als reinen base64-String (ohne data:-Präfix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'));
    reader.readAsDataURL(file);
  });
}

let manualIdSeq = 0;
function nextManualId(): string {
  manualIdSeq += 1;
  return `mf-${manualIdSeq}`;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function splitList(s: string): string[] {
  return s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Modal "E-Mail versenden" für einen bestehenden Eingang.
 *
 * - Empfänger / CC werden NICHT vorbefüllt; der Admin wählt aus einer
 *   sortierten Dropdown-Liste (Favoriten → Auftraggeber-Adressen).
 * - Empfänger werden als Tags/Chips gehalten — Tippen + Enter / Komma
 *   oder Auswahl aus dem Dropdown fügt einen Tag hinzu.
 * - Betreff aus der Template-E-Mail-Config vorbefüllt, editierbar.
 * - Anhänge: alle PDFs des Eingangs als vorausgefüllt angehakte
 *   Checkboxen.
 */
export function EingangSendEmailDialog({ formular, template, onClose, onSent }: Props) {
  const guard = useTestGuard();
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);
  // --- Adress-Quellen für die Dropdowns ------------------------------
  const [options, setOptions] = useState<EmailOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  const reloadOptions = useCallback(async () => {
    setOptionsLoading(true);
    // 1) Favoriten (Admin-only Tabelle).
    const favRes = await supabase
      .from('email_favoriten')
      .select('id, email, name, ist_favorit')
      .order('ist_favorit', { ascending: false })
      .order('email', { ascending: true });
    const favs: EmailFavorit[] = (favRes.data as EmailFavorit[]) ?? [];

    // 2) Auftraggeber-Stamm: email1, email2 + sachbearbeiter (falls
    //    parsebar). Wir nehmen den Namen aus auftraggeber.name oder
    //    sachbearbeiter dazu, damit das Dropdown lesbar wird.
    const agRes = await supabase
      .from('auftraggeber')
      .select('name, email1, email2, sachbearbeiter')
      .order('name', { ascending: true });
    type AgRow = { name: string; email1: string | null; email2: string | null; sachbearbeiter: string | null };
    const ag: AgRow[] = (agRes.data as AgRow[]) ?? [];

    // 3) Auftraggeber-Kontakte (Ansprechpartner mit E-Mail-Adresse).
    const kRes = await supabase
      .from('auftraggeber_kontakte')
      .select('name, email, auftraggeber:auftraggeber_id (name)')
      .not('email', 'is', null);
    type KRow = { name: string | null; email: string | null; auftraggeber: { name: string } | null };
    const kontakte: KRow[] = (kRes.data as unknown as KRow[]) ?? [];

    // Zusammenführen — pro normalisierter Adresse höchstens EIN Eintrag.
    // Favorit gewinnt; sonst erster Treffer aus auftraggeber.
    const byEmail = new Map<string, EmailOption>();

    for (const f of favs) {
      if (!f.email || !EMAIL_RE.test(f.email)) continue;
      byEmail.set(norm(f.email), {
        email: f.email,
        name: f.name ?? null,
        source: 'favorit',
        favoritId: f.id,
        ist_favorit: !!f.ist_favorit,
      });
    }
    const addAuftraggeber = (email: string | null, name: string | null) => {
      if (!email) return;
      const trimmed = email.trim();
      if (!EMAIL_RE.test(trimmed)) return;
      const key = norm(trimmed);
      if (byEmail.has(key)) return;
      byEmail.set(key, {
        email: trimmed,
        name: name?.trim() || null,
        source: 'auftraggeber',
        ist_favorit: false,
      });
    };
    for (const a of ag) {
      addAuftraggeber(a.email1, a.name);
      addAuftraggeber(a.email2, a.name);
    }
    for (const k of kontakte) {
      const fallback = k.auftraggeber?.name ?? null;
      const nm = k.name?.trim() || fallback;
      addAuftraggeber(k.email, nm);
    }

    setOptions([...byEmail.values()]);
    setOptionsLoading(false);
  }, []);

  useEffect(() => { void reloadOptions(); }, [reloadOptions]);

  // --- Initiale Werte aus Template-Config ----------------------------
  const initial = useMemo(() => {
    const cfg = template.email_config ?? null;
    const data = formular.daten as Record<string, unknown>;
    const subject = cfg?.subject_pattern
      ? resolvePattern(cfg.subject_pattern, data)
      : template.name;
    const body = cfg?.body_pattern ? resolvePattern(cfg.body_pattern, data) : '';
    const persisted = asPdfPathList((formular as unknown as { pdf_paths?: unknown }).pdf_paths);
    const wanted = new Set(cfg?.attach_pdf_ids ?? []);
    const attachments: AttachmentDraft[] = persisted.length > 0
      ? persisted.map((p) => ({
          id: p.pdf_id,
          name: p.pdf_name,
          filename: p.filename,
          onedrive_path: p.onedrive_path,
          selected: true,
        }))
      : (template.pdfs ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          filename: resolveFilename(p.filename_pattern, data, p.id),
          onedrive_path: expectedOneDrivePath(template, formular, p),
          selected: wanted.size === 0 ? true : wanted.has(p.id),
        }));
    return { subject, body, attachments };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, formular.id]);

  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(initial.attachments);
  // Manuell hinzugefügte Dateien (nur für diesen Versand, kein Upload).
  const [manualFiles, setManualFiles] = useState<ManualFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Absender: bevorzugt das im Template (E-Mail 3) konfigurierte Postfach,
  // sonst mail_inbox_2 (protokollierung@) als globaler Default.
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [from, setFrom] = useState<string>('');
  const templateFrom = template.email_config?.from ?? '';
  useEffect(() => {
    void loadMailboxes().then((mbs) => {
      const usable = mbs.filter((m) => m.address.trim() !== '');
      setMailboxes(usable);
      const tplMatch = templateFrom && usable.find((m) => m.address === templateFrom);
      const def = tplMatch ?? usable.find((m) => m.key === 'mail_inbox_2') ?? usable[0];
      if (def) setFrom(def.address);
    });
  }, [templateFrom]);
  // Optional „Als Favorit speichern" pro NEUER Adresse beim Senden.
  // Map: normalisierte E-Mail → boolean
  const [saveAsFav, setSaveAsFav] = useState<Record<string, boolean>>({});

  function toggleAttachment(id: string) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)));
  }

  /** Neue Dateien validieren und übernehmen (Typ, Einzel- und Gesamt-
   *  größe). Ungültige Dateien werden mit Sammel-Fehlermeldung abgewiesen. */
  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    if (list.length === 0) return;
    const errors: string[] = [];
    setManualFiles((prev) => {
      let total = prev.reduce((sum, m) => sum + m.file.size, 0);
      const next = [...prev];
      for (const file of list) {
        if (!isAllowedFile(file)) {
          errors.push(`${file.name}: Dateityp nicht erlaubt (PDF, JPG, PNG, DOCX, XLSX).`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          errors.push(`${file.name}: zu groß (${formatBytes(file.size)}, max. ${formatBytes(MAX_FILE_BYTES)}).`);
          continue;
        }
        // Duplikate (gleicher Name + Größe) überspringen.
        if (next.some((m) => m.file.name === file.name && m.file.size === file.size)) continue;
        if (total + file.size > MAX_TOTAL_BYTES) {
          errors.push(`${file.name}: Gesamtgröße überschreitet ${formatBytes(MAX_TOTAL_BYTES)}.`);
          continue;
        }
        total += file.size;
        next.push({ id: nextManualId(), file });
      }
      return next;
    });
    setAttachError(errors.length > 0 ? errors.join(' ') : null);
  }

  function removeManualFile(id: string) {
    setManualFiles((prev) => prev.filter((m) => m.id !== id));
    setAttachError(null);
  }

  const manualTotal = useMemo(
    () => manualFiles.reduce((sum, m) => sum + m.file.size, 0),
    [manualFiles],
  );

  // Adressen, die als NEU gelten (= weder in Favoriten noch in Auftraggeber-
  // Liste bekannt). Für diese zeigen wir die optionale „Als Favorit
  // speichern"-Checkbox an.
  const knownEmails = useMemo(() => {
    const s = new Set<string>();
    for (const o of options) s.add(norm(o.email));
    return s;
  }, [options]);

  const newEmails = useMemo(
    () => [...to, ...cc].filter((e) => !knownEmails.has(norm(e))),
    [to, cc, knownEmails],
  );

  async function toggleFavorit(opt: EmailOption) {
    // Klick aufs Stern-Icon im Dropdown: Favorit-Status flippen.
    if (opt.favoritId) {
      const { error: err } = await supabase
        .from('email_favoriten')
        .update({ ist_favorit: !opt.ist_favorit })
        .eq('id', opt.favoritId);
      if (err) { setError(err.message); return; }
    } else {
      // Adresse ist bisher nur "auftraggeber" — als Favorit anlegen.
      const { error: err } = await supabase
        .from('email_favoriten')
        .insert({ email: opt.email, name: opt.name, ist_favorit: true });
      if (err) { setError(err.message); return; }
    }
    await reloadOptions();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (to.length === 0) { setError('Mindestens einen Empfänger angeben.'); return; }
    if (!subject.trim()) { setError('Betreff darf nicht leer sein.'); return; }
    if (guard()) { onClose(); return; }
    const selected = attachments.filter((a) => a.selected);
    setBusy(true);
    try {
      // Vor dem Versand: alle Adressen mit gesetzter „als Favorit
      // speichern"-Checkbox in email_favoriten anlegen (Upsert auf
      // lower(email)).
      const toFav = Object.entries(saveAsFav)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (toFav.length > 0) {
        const rows = toFav.map((normalized) => {
          const original = [...to, ...cc].find((x) => norm(x) === normalized) ?? normalized;
          return { email: original, ist_favorit: true };
        });
        // onConflict greift auf lower(email)-unique-Index nicht; daher
        // erst checken, was schon da ist, und nur fehlende inserten.
        const { data: existing } = await supabase
          .from('email_favoriten')
          .select('email')
          .in('email', rows.map((r) => r.email));
        const have = new Set((existing ?? []).map((r) => norm(r.email)));
        const missing = rows.filter((r) => !have.has(norm(r.email)));
        if (missing.length > 0) {
          await supabase.from('email_favoriten').insert(missing);
        }
      }

      // Manuelle Dateien als base64 einlesen — sie werden nur für diesen
      // Versand mitgeschickt (kein OneDrive/Supabase-Upload).
      const manualAttachments = await Promise.all(
        manualFiles.map(async (m) => ({
          name: m.file.name,
          contentType: m.file.type || 'application/octet-stream',
          content_base64: await fileToBase64(m.file),
        })),
      );

      // Plain-Text wird HTML-escaped + Signatur angehängt (Aufgabe 1).
      const bodyHtml = bodyWithSignatureHtml({ body, sig });
      const result = await sendEmail({
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject,
        body,
        bodyHtml,
        from: from || undefined,
        attachments: selected.map((a) => ({
          name: a.filename,
          contentType: 'application/pdf',
          onedrive_path: a.onedrive_path,
        })),
        manualAttachments: manualAttachments.length > 0 ? manualAttachments : undefined,
      });
      // Versand-Zeitpunkt am Eingang festhalten (analog zu Rechnungen) —
      // die Mail ging raus, auch wenn einzelne Anhänge fehlten.
      const versendetAm = new Date().toISOString();
      await supabase
        .from('ausgefuellte_formulare')
        .update({ email_versendet_am: versendetAm })
        .eq('id', formular.id);
      if (result.missing.length > 0) {
        setError(
          `E-Mail versendet, aber ${result.missing.length} Anhang/Anhänge fehlten: `
          + `${result.missing.join(', ')}. PDFs ggf. neu erzeugen und erneut senden.`,
        );
      } else {
        // Anhänge-Liste zurücksetzen (Dialog wird i. d. R. ohnehin
        // geschlossen, aber defensiv leeren).
        setManualFiles([]);
        setAttachError(null);
        onSent();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Versand fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">E-Mail versenden</h2>
            <p className="text-xs text-maja-muted">
              Eingang von {formular.created_at?.slice(0, 10) ?? '—'} — Empfänger
              aus dem Dropdown wählen oder direkt eintippen.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen"><XIcon className="h-4 w-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {mailboxes.length > 0 && (
            <div>
              <label htmlFor="re-from" className="label">Von</label>
              <select
                id="re-from"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={mailboxes.length === 1}
              >
                {mailboxes.map((m) => (
                  <option key={m.key} value={m.address}>
                    {m.address}{m.label ? ` (${m.label})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <EmailRecipientField
            label="An"
            value={to}
            onChange={setTo}
            options={options}
            optionsLoading={optionsLoading}
            onToggleFavorit={toggleFavorit}
          />
          <EmailRecipientField
            label="CC (optional)"
            value={cc}
            onChange={setCc}
            options={options}
            optionsLoading={optionsLoading}
            onToggleFavorit={toggleFavorit}
          />

          {newEmails.length > 0 && (
            <div className="rounded-md border border-maja-navy/15 bg-maja-light/30 p-2">
              <p className="mb-1 text-xs font-medium text-maja-ink">
                Neue Adresse — als Favorit speichern?
              </p>
              <div className="space-y-1">
                {newEmails.map((e) => {
                  const key = norm(e);
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        checked={!!saveAsFav[key]}
                        onChange={(ev) => setSaveAsFav((prev) => ({ ...prev, [key]: ev.target.checked }))}
                      />
                      <span className="font-medium text-maja-ink">{e}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="re-subject" className="label">Betreff</label>
            <input id="re-subject" className="input" value={subject}
                   onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="re-body" className="label">Text</label>
            <textarea id="re-body" className="input min-h-[6rem]" value={body}
                      onChange={(e) => setBody(e.target.value)} />
          </div>

          <div>
            <span className="label">Generierte Dokumente</span>
            {attachments.length === 0 ? (
              <p className="text-xs text-maja-muted">
                Keine PDF-Vorlagen am Template — es werden keine generierten
                Dokumente angehängt.
              </p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        checked={a.selected}
                        onChange={() => toggleAttachment(a.id)}
                      />
                      <span className="font-medium text-maja-ink">{a.name}</span>
                      <span className="text-xs text-maja-muted">{a.filename}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="label">Eigene Anhänge</span>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
              }}
              className={
                'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed '
                + 'px-4 py-5 text-center text-sm transition '
                + (dragOver
                  ? 'border-maja-navy bg-maja-navy/5 text-maja-navy'
                  : 'border-maja-navy/25 text-maja-muted hover:border-maja-navy/50 hover:bg-maja-light/40')
              }
            >
              <span className="font-medium text-maja-ink">Datei hinzufügen</span>
              <span className="text-xs">
                Klicken oder hierher ziehen · PDF, JPG, PNG, DOCX, XLSX ·
                max. {formatBytes(MAX_FILE_BYTES)} pro Datei
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {manualFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {manualFiles.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 rounded-md border border-maja-navy/10 bg-maja-light/40 px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-maja-ink" title={m.file.name}>
                      {m.file.name}
                    </span>
                    <span className="shrink-0 text-xs text-maja-muted">{formatBytes(m.file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeManualFile(m.id)}
                      className="shrink-0 rounded-md p-1 text-maja-muted hover:bg-maja-navy/10 hover:text-red-600"
                      aria-label={`${m.file.name} entfernen`}
                      title="Entfernen"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {manualFiles.length > 0 && (
              <p className="mt-1 text-xs text-maja-muted">
                {manualFiles.length} Datei(en) · {formatBytes(manualTotal)} von {formatBytes(MAX_TOTAL_BYTES)}
              </p>
            )}
            {attachError && (
              <p role="alert" className="mt-1 text-xs text-red-600">{attachError}</p>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sendet …' : 'Senden'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Recipient-Field mit Tag-Eingabe + Dropdown ---------------------

interface RecipientFieldProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: EmailOption[];
  optionsLoading: boolean;
  onToggleFavorit: (opt: EmailOption) => void;
}

function EmailRecipientField({
  label, value, onChange, options, optionsLoading, onToggleFavorit,
}: RecipientFieldProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputId = useMemo(() => `recip-${Math.random().toString(36).slice(2, 8)}`, []);

  // Klick außerhalb → Dropdown zu.
  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function addTag(raw: string) {
    const candidates = splitList(raw);
    if (candidates.length === 0) return;
    const present = new Set(value.map(norm));
    const additions: string[] = [];
    for (const c of candidates) {
      if (!EMAIL_RE.test(c)) continue;
      const k = norm(c);
      if (present.has(k)) continue;
      present.add(k);
      additions.push(c);
    }
    if (additions.length > 0) onChange([...value, ...additions]);
    setInput('');
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
      ev.preventDefault();
      if (input.trim()) addTag(input);
    } else if (ev.key === 'Backspace' && input === '' && value.length > 0) {
      // Letzten Tag entfernen, wenn das Feld leer ist.
      onChange(value.slice(0, -1));
    } else if (ev.key === 'Escape') {
      setOpen(false);
    }
  }

  // Dropdown-Inhalt: Favoriten zuerst, dann Auftraggeber. Filterung
  // nach Tippeingabe (case-insensitive über email + name).
  const filtered = useMemo(() => {
    const q = norm(input);
    const matches = (o: EmailOption) => {
      if (!q) return true;
      return norm(o.email).includes(q) || (o.name && norm(o.name).includes(q));
    };
    const taken = new Set(value.map(norm));
    const visible = options
      .filter((o) => !taken.has(norm(o.email)))
      .filter(matches);
    const fav = visible.filter((o) => o.ist_favorit);
    const rest = visible.filter((o) => !o.ist_favorit);
    return { fav, rest };
  }, [options, input, value]);

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="label">{label}</label>
      <div
        className="input flex flex-wrap items-center gap-1 px-2 py-1"
        onClick={() => {
          const el = document.getElementById(inputId);
          el?.focus();
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs text-maja-navy"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full p-0.5 text-maja-navy/70 hover:bg-maja-navy/15"
              aria-label={`${tag} entfernen`}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="email"
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none focus:ring-0"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Falls noch ein gültiges, halb-eingetipptes E-Mail im Feld
            // hängt, beim Verlassen als Tag übernehmen — sonst geht es
            // beim Submit verloren.
            if (input.trim() && EMAIL_RE.test(input.trim())) addTag(input);
          }}
          placeholder={value.length === 0 ? 'E-Mail-Adresse eingeben oder auswählen …' : ''}
        />
      </div>
      {open && (filtered.fav.length > 0 || filtered.rest.length > 0 || optionsLoading) && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-maja-navy/15 bg-white shadow-lg">
          {optionsLoading && (
            <p className="px-3 py-2 text-xs text-maja-muted">Lade Adressen …</p>
          )}
          {filtered.fav.length > 0 && (
            <div>
              <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                Favoriten
              </div>
              {filtered.fav.map((o) => (
                <EmailOptionRow
                  key={`fav-${norm(o.email)}`}
                  opt={o}
                  onSelect={() => { addTag(o.email); setOpen(false); }}
                  onToggleFavorit={() => onToggleFavorit(o)}
                />
              ))}
            </div>
          )}
          {filtered.rest.length > 0 && (
            <div>
              {filtered.fav.length > 0 && (
                <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                  Auftraggeber
                </div>
              )}
              {filtered.rest.map((o) => (
                <EmailOptionRow
                  key={`ag-${norm(o.email)}`}
                  opt={o}
                  onSelect={() => { addTag(o.email); setOpen(false); }}
                  onToggleFavorit={() => onToggleFavorit(o)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmailOptionRow({
  opt, onSelect, onToggleFavorit,
}: {
  opt: EmailOption;
  onSelect: () => void;
  onToggleFavorit: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-maja-navy/5 px-3 py-1.5 text-sm last:border-b-0 hover:bg-maja-light/40">
      <button
        type="button"
        onClick={onToggleFavorit}
        className={'p-0.5 ' + (opt.ist_favorit ? 'text-amber-500' : 'text-maja-muted hover:text-amber-500')}
        aria-label={opt.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}
        title={opt.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}
      >
        <StarIcon className="h-4 w-4" filled={opt.ist_favorit} />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-maja-ink">
          {opt.name ? <span className="font-medium">{opt.name} — </span> : null}
          {opt.email}
        </span>
      </button>
    </div>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
    </svg>
  );
}
