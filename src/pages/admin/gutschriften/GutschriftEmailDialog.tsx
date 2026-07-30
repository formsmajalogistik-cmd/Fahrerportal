// E-Mail-Versand für eine Gutschrift.
//
// Aufbau bewusst identisch zum Rechnungs-Dialog (Empfänger-Chips mit
// Favoriten-Dropdown, "Von"-Auswahl mit info@ als Default, Signatur).
// Zusätzlich: eigene Dateien anhängen wie im Eingangs-Dialog — die
// reisen als base64 im JSON-Body der Vercel-Function und haben deshalb
// ein konservatives Budget, während die Gutschrift-PDF serverseitig
// über ihren OneDrive-Pfad geladen wird.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react';
import { supabase } from '../../../lib/supabase';
import { sendEmail } from '../../../lib/onedrive';
import { useAuth } from '../../../auth/AuthContext';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../../lib/emailSignature';
import { XIcon } from '../../../components/icons';
import { formatDate, formatEuro } from '../../../lib/touren';
import { loadMailboxes, type MailboxConfig } from '../../../lib/mailboxSettings';
import { gutschriftPdfFilename } from '../../../lib/gutschriften';
import type { EmailFavorit } from '../../../types/db';

interface Props {
  gutschrift: {
    id: string;
    gutschrift_nr: string;
    datum: string;
    brutto_summe: number;
    auftraggeber_id: string | null;
    pdf_url: string | null;
  };
  /** Konfigurierte Dokumentbezeichnung (Gutschrift / Rechnungskorrektur …). */
  bezeichnung: string;
  onClose: () => void;
  onSent: () => void;
}

interface EmailOption {
  email: string;
  name: string | null;
  favoritId?: string;
  ist_favorit: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (s: string) => s.trim().toLowerCase();
const splitList = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);

// Gleiche Grenzen wie im Eingangs-Dialog: base64 bläht ~+37 % auf, der
// Function-Body liegt bei ~4,5 MB.
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'];
const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

interface ManualFile { id: string; file: File }

let manualIdSeq = 0;
function nextManualId(): string { manualIdSeq += 1; return `gsf-${manualIdSeq}`; }

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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

export function GutschriftEmailDialog({ gutschrift, bezeichnung, onClose, onSent }: Props) {
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);

  const [options, setOptions] = useState<EmailOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const [subject, setSubject] = useState(
    `${bezeichnung} ${gutschrift.gutschrift_nr} — Maja-Logistik`,
  );
  const [body, setBody] = useState(defaultBody(gutschrift, bezeichnung));
  const [attachPdf, setAttachPdf] = useState<boolean>(!!gutschrift.pdf_url);
  const [manualFiles, setManualFiles] = useState<ManualFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default-Absender info@ (mail_inbox_1) — wie bei den Rechnungen.
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [from, setFrom] = useState<string>('');
  useEffect(() => {
    void loadMailboxes().then((mbs) => {
      const usable = mbs.filter((m) => m.address.trim() !== '');
      setMailboxes(usable);
      const def = usable.find((m) => m.key === 'mail_inbox_1') ?? usable[0];
      if (def) setFrom(def.address);
    });
  }, []);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    const favRes = await supabase
      .from('email_favoriten')
      .select('id, email, name, ist_favorit')
      .order('ist_favorit', { ascending: false })
      .order('email', { ascending: true });
    const byEmail = new Map<string, EmailOption>();
    for (const f of ((favRes.data as EmailFavorit[]) ?? [])) {
      if (!EMAIL_RE.test(f.email)) continue;
      byEmail.set(norm(f.email), {
        email: f.email, name: f.name ?? null,
        favoritId: f.id, ist_favorit: !!f.ist_favorit,
      });
    }
    if (gutschrift.auftraggeber_id) {
      const agRes = await supabase
        .from('auftraggeber')
        .select('name, email1, email2')
        .eq('id', gutschrift.auftraggeber_id)
        .maybeSingle();
      type AgRow = { name: string; email1: string | null; email2: string | null };
      const ag = (agRes.data as AgRow | null) ?? null;
      const add = (email: string | null, name: string | null) => {
        if (!email || !EMAIL_RE.test(email.trim())) return;
        const key = norm(email);
        if (byEmail.has(key)) return;
        byEmail.set(key, { email: email.trim(), name, ist_favorit: false });
      };
      if (ag) { add(ag.email1, ag.name); add(ag.email2, ag.name); }
      const kRes = await supabase
        .from('auftraggeber_kontakte')
        .select('name, email')
        .eq('auftraggeber_id', gutschrift.auftraggeber_id)
        .not('email', 'is', null);
      for (const k of ((kRes.data as Array<{ name: string | null; email: string | null }>) ?? [])) {
        add(k.email, k.name ?? null);
      }
    }
    setOptions([...byEmail.values()]);
    setOptionsLoading(false);
  }, [gutschrift.auftraggeber_id]);

  useEffect(() => {
    void Promise.resolve().then(() => { void loadOptions(); });
  }, [loadOptions]);

  const manualTotal = manualFiles.reduce((sum, m) => sum + m.file.size, 0);

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    if (list.length === 0) return;
    const errors: string[] = [];
    setManualFiles((prev) => {
      let total = prev.reduce((sum, m) => sum + m.file.size, 0);
      const next = [...prev];
      for (const file of list) {
        if (!ALLOWED_EXT.includes(fileExt(file.name))) {
          errors.push(`${file.name}: Dateityp nicht erlaubt (PDF, JPG, PNG, DOCX, XLSX).`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          errors.push(`${file.name}: zu groß (${formatBytes(file.size)}, max. ${formatBytes(MAX_FILE_BYTES)}).`);
          continue;
        }
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (to.length === 0) { setError('Mindestens ein Empfänger ist erforderlich.'); return; }
    if (!attachPdf && manualFiles.length === 0) {
      setError('Mindestens ein Anhang muss ausgewählt sein.');
      return;
    }
    setBusy(true);
    try {
      const attachments: Array<{ name: string; contentType: string; onedrive_path: string }> = [];
      if (attachPdf && gutschrift.pdf_url) {
        attachments.push({
          name: gutschriftPdfFilename(bezeichnung, gutschrift.gutschrift_nr),
          contentType: 'application/pdf',
          onedrive_path: gutschrift.pdf_url,
        });
      }
      const manualAttachments = await Promise.all(
        manualFiles.map(async (m) => ({
          name: m.file.name,
          contentType: m.file.type || 'application/octet-stream',
          content_base64: await fileToBase64(m.file),
        })),
      );
      const bodyHtml = bodyWithSignatureHtml({ body, sig });
      const result = await sendEmail({
        to, cc: cc.length > 0 ? cc : undefined,
        subject, body, bodyHtml,
        from: from || undefined,
        attachments,
        manualAttachments: manualAttachments.length > 0 ? manualAttachments : undefined,
      });
      if (result.missing.length > 0) {
        setError(
          `E-Mail versendet, aber ${result.missing.length} Anhang/Anhänge fehlten: `
          + `${result.missing.join(', ')}.`,
        );
      }
      await supabase
        .from('gutschriften')
        .update({ email_versendet_am: new Date().toISOString() })
        .eq('id', gutschrift.id);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Versand fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorit(opt: EmailOption) {
    if (opt.favoritId) {
      const { error: err } = await supabase
        .from('email_favoriten')
        .update({ ist_favorit: !opt.ist_favorit })
        .eq('id', opt.favoritId);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase
        .from('email_favoriten')
        .insert({ email: opt.email, name: opt.name, ist_favorit: true });
      if (err) { setError(err.message); return; }
    }
    await loadOptions();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">
              {bezeichnung} per E-Mail versenden
            </h2>
            <p className="text-xs text-maja-muted">
              {gutschrift.gutschrift_nr} · {formatDate(gutschrift.datum)} ·{' '}
              {formatEuro(Number(gutschrift.brutto_summe))} brutto
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {mailboxes.length > 0 && (
            <div>
              <label htmlFor="gs-from" className="label">Von</label>
              <select id="gs-from" className="input" value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      disabled={mailboxes.length === 1}>
                {mailboxes.map((m) => (
                  <option key={m.key} value={m.address}>
                    {m.address}{m.label ? ` (${m.label})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <RecipientField label="An" value={to} onChange={setTo}
                          options={options} optionsLoading={optionsLoading}
                          onToggleFavorit={toggleFavorit} />
          {ccOpen ? (
            <RecipientField label="CC" value={cc} onChange={setCc}
                            options={options} optionsLoading={optionsLoading}
                            onToggleFavorit={toggleFavorit} />
          ) : (
            <button type="button" className="text-xs font-medium text-maja-accent hover:underline"
                    onClick={() => setCcOpen(true)}>
              + CC hinzufügen
            </button>
          )}
          <div>
            <label htmlFor="gs-subject" className="label">Betreff</label>
            <input id="gs-subject" className="input" value={subject}
                   onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gs-body" className="label">Nachricht</label>
            <textarea id="gs-body" className="input min-h-[8rem]" value={body}
                      onChange={(e) => setBody(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-maja-muted">
              Signatur wird automatisch angehängt.
            </p>
          </div>

          <div>
            <span className="label">Anhänge</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                     checked={attachPdf}
                     disabled={!gutschrift.pdf_url}
                     onChange={(e) => setAttachPdf(e.target.checked)} />
              <span className={gutschrift.pdf_url ? 'font-medium text-maja-ink' : 'text-maja-muted'}>
                {bezeichnung}-PDF
              </span>
              {!gutschrift.pdf_url && (
                <span className="text-[11px] text-maja-muted">(noch nicht generiert)</span>
              )}
            </label>

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
                'mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed '
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
              <>
                <ul className="mt-2 space-y-1">
                  {manualFiles.map((m) => (
                    <li key={m.id}
                        className="flex items-center gap-2 rounded-md border border-maja-navy/10 bg-maja-light/40 px-2 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium text-maja-ink" title={m.file.name}>
                        {m.file.name}
                      </span>
                      <span className="shrink-0 text-xs text-maja-muted">{formatBytes(m.file.size)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setManualFiles((prev) => prev.filter((x) => x.id !== m.id));
                          setAttachError(null);
                        }}
                        className="shrink-0 rounded-md p-1 text-maja-muted hover:bg-maja-navy/10 hover:text-red-600"
                        aria-label={`${m.file.name} entfernen`}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-maja-muted">
                  {manualFiles.length} Datei(en) · {formatBytes(manualTotal)} von {formatBytes(MAX_TOTAL_BYTES)}
                </p>
              </>
            )}
            {attachError && <p role="alert" className="mt-1 text-xs text-red-600">{attachError}</p>}
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

function defaultBody(
  gs: { gutschrift_nr: string; datum: string; brutto_summe: number },
  bezeichnung: string,
): string {
  return (
    'Sehr geehrte Damen und Herren,\n\n'
    + `anbei erhalten Sie die ${bezeichnung} ${gs.gutschrift_nr} vom ${formatDate(gs.datum)}.\n\n`
    + `Betrag: ${formatEuro(Number(gs.brutto_summe))} (brutto)`
  );
}

// ---- Empfänger-Chips mit Favoriten-Dropdown --------------------------

function RecipientField({
  label, value, onChange, options, optionsLoading, onToggleFavorit,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: EmailOption[];
  optionsLoading: boolean;
  onToggleFavorit: (opt: EmailOption) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrap.current) return;
      if (!wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function addTag(raw: string) {
    const present = new Set(value.map(norm));
    const adds: string[] = [];
    for (const c of splitList(raw)) {
      if (!EMAIL_RE.test(c)) continue;
      const k = norm(c);
      if (present.has(k)) continue;
      present.add(k);
      adds.push(c);
    }
    if (adds.length > 0) onChange([...value, ...adds]);
    setInput('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const filtered = useMemo(() => {
    const q = norm(input);
    const taken = new Set(value.map(norm));
    const visible = options
      .filter((o) => !taken.has(norm(o.email)))
      .filter((o) => !q || norm(o.email).includes(q) || (o.name && norm(o.name).includes(q)));
    return {
      fav: visible.filter((o) => o.ist_favorit),
      rest: visible.filter((o) => !o.ist_favorit),
    };
  }, [options, input, value]);

  return (
    <div ref={wrap} className="relative">
      <label htmlFor={inputId} className="label">{label}</label>
      <div className="input flex flex-wrap items-center gap-1 px-2 py-1"
           onClick={() => document.getElementById(inputId)?.focus()}>
        {value.map((tag) => (
          <span key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs text-maja-navy">
            {tag}
            <button type="button"
                    onClick={() => onChange(value.filter((v) => v !== tag))}
                    className="rounded-full p-0.5 text-maja-navy/70 hover:bg-maja-navy/15"
                    aria-label={`${tag} entfernen`}>
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
          onBlur={() => { if (input.trim() && EMAIL_RE.test(input.trim())) addTag(input); }}
          placeholder={value.length === 0 ? 'E-Mail-Adresse eingeben oder auswählen …' : ''}
        />
      </div>
      {open && (optionsLoading || filtered.fav.length > 0 || filtered.rest.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-maja-navy/15 bg-white shadow-lg">
          {optionsLoading && <p className="px-3 py-2 text-xs text-maja-muted">Lade Adressen …</p>}
          {filtered.fav.length > 0 && (
            <div>
              <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                Favoriten
              </div>
              {filtered.fav.map((o) => (
                <OptionRow key={`fav-${norm(o.email)}`} opt={o}
                           onSelect={() => { addTag(o.email); setOpen(false); }}
                           onToggle={() => onToggleFavorit(o)} />
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
                <OptionRow key={`ag-${norm(o.email)}`} opt={o}
                           onSelect={() => { addTag(o.email); setOpen(false); }}
                           onToggle={() => onToggleFavorit(o)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  opt, onSelect, onToggle,
}: { opt: EmailOption; onSelect: () => void; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-maja-navy/5 px-3 py-1.5 text-sm last:border-b-0 hover:bg-maja-light/40">
      <button type="button" onClick={onToggle}
              className={'p-0.5 ' + (opt.ist_favorit ? 'text-amber-500' : 'text-maja-muted hover:text-amber-500')}
              aria-label={opt.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}>
        <Star filled={opt.ist_favorit} />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-maja-ink">
          {opt.name ? <span className="font-medium">{opt.name} — </span> : null}
          {opt.email}
        </span>
      </button>
    </div>
  );
}

function Star({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4"
         fill={filled ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
    </svg>
  );
}
