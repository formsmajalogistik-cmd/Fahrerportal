// „Auftrag per E-Mail versenden" — Tour-Details an den Fahrer.
//
// Aufbau bewusst identisch zum Rechnungs- und Gutschrift-Dialog:
// Empfänger-Chips mit Favoriten-Dropdown, „Von"-Auswahl, Signatur,
// optionale eigene Anhänge. Vorbelegt ist die E-Mail des zugewiesenen
// Fahrers; Betreff und Text kommen aus der Vorlage (Einstellungen →
// Auftrags-E-Mail) und sind hier noch änderbar.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react';
import { supabase } from '../../lib/supabase';
import { sendEmail } from '../../lib/onedrive';
import { useAuth } from '../../auth/AuthContext';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../lib/emailSignature';
import { XIcon } from '../../components/icons';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import {
  buildPlatzhalter, loadAuftragsEmail, resolveAuftragsText,
  type AuftragsTour,
} from '../../lib/auftragsEmail';
import type { EmailFavorit } from '../../types/db';

interface Props {
  tour: AuftragsTour;
  /** Vorbelegter Empfänger + Anzeigename des zugewiesenen Fahrers. */
  fahrerEmail: string | null;
  fahrerName: string | null;
  auftraggeberName: string | null;
  auftraggeberId: string | null;
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
function nextManualId(): string { manualIdSeq += 1; return `af-${manualIdSeq}`; }

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

export function AuftragEmailDialog({
  tour, fahrerEmail, fahrerName, auftraggeberName, auftraggeberId, onClose, onSent,
}: Props) {
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);

  const [options, setOptions] = useState<EmailOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [to, setTo] = useState<string[]>(
    fahrerEmail && EMAIL_RE.test(fahrerEmail) ? [fahrerEmail] : [],
  );
  const [cc, setCc] = useState<string[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [vorlageGeladen, setVorlageGeladen] = useState(false);
  const [manualFiles, setManualFiles] = useState<ManualFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [from, setFrom] = useState<string>('');

  // Vorlage laden und Platzhalter auflösen.
  useEffect(() => {
    let abgebrochen = false;
    void (async () => {
      const [vorlage, mbs, werte] = await Promise.all([
        loadAuftragsEmail(),
        loadMailboxes(),
        buildPlatzhalter(tour, { fahrerName, auftraggeberName }),
      ]);
      if (abgebrochen) return;
      const usable = mbs.filter((m) => m.address.trim() !== '');
      setMailboxes(usable);
      const def = usable.find((m) => m.key === vorlage.from) ?? usable[0];
      if (def) setFrom(def.address);
      setSubject(resolveAuftragsText(vorlage.subject, werte));
      setBody(resolveAuftragsText(vorlage.body, werte));
      setVorlageGeladen(true);
    })();
    return () => { abgebrochen = true; };
  }, [tour, fahrerName, auftraggeberName]);

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
    // Fahrer-Adresse immer anbieten, auch wenn sie kein Favorit ist.
    if (fahrerEmail && EMAIL_RE.test(fahrerEmail) && !byEmail.has(norm(fahrerEmail))) {
      byEmail.set(norm(fahrerEmail), {
        email: fahrerEmail, name: fahrerName ?? 'Fahrer', ist_favorit: false,
      });
    }
    if (auftraggeberId) {
      const kRes = await supabase
        .from('auftraggeber_kontakte')
        .select('name, email')
        .eq('auftraggeber_id', auftraggeberId)
        .not('email', 'is', null);
      for (const k of ((kRes.data as Array<{ name: string | null; email: string | null }>) ?? [])) {
        if (!k.email || !EMAIL_RE.test(k.email.trim())) continue;
        const key = norm(k.email);
        if (byEmail.has(key)) continue;
        byEmail.set(key, { email: k.email.trim(), name: k.name ?? null, ist_favorit: false });
      }
    }
    setOptions([...byEmail.values()]);
    setOptionsLoading(false);
  }, [fahrerEmail, fahrerName, auftraggeberId]);

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
    setBusy(true);
    try {
      const manualAttachments = await Promise.all(
        manualFiles.map(async (m) => ({
          name: m.file.name,
          contentType: m.file.type || 'application/octet-stream',
          content_base64: await fileToBase64(m.file),
        })),
      );
      const bodyHtml = bodyWithSignatureHtml({ body, sig });
      await sendEmail({
        to, cc: cc.length > 0 ? cc : undefined,
        subject, body, bodyHtml,
        from: from || undefined,
        attachments: [],
        manualAttachments: manualAttachments.length > 0 ? manualAttachments : undefined,
      });
      await supabase
        .from('touren')
        .update({ auftrag_versendet_am: new Date().toISOString() })
        .eq('id', tour.id);
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
        .from('email_favoriten').update({ ist_favorit: !opt.ist_favorit }).eq('id', opt.favoritId);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase
        .from('email_favoriten').insert({ email: opt.email, name: opt.name, ist_favorit: true });
      if (err) { setError(err.message); return; }
    }
    await loadOptions();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Auftrag per E-Mail versenden</h2>
            <p className="text-xs text-maja-muted">
              {tour.tour_id ? `Tour ${tour.tour_id} · ` : ''}
              {tour.start_stadt} → {tour.ziel_stadt}
              {tour.rueckfuehrung_stadt ? ` → ${tour.rueckfuehrung_stadt}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {!vorlageGeladen ? (
          <p className="text-sm text-maja-muted">Vorlage wird geladen …</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            {mailboxes.length > 0 && (
              <div>
                <label htmlFor="af-from" className="label">Von</label>
                <select id="af-from" className="input" value={from}
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
              <label htmlFor="af-subject" className="label">Betreff</label>
              <input id="af-subject" className="input" value={subject}
                     onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label htmlFor="af-body" className="label">Nachricht</label>
              <textarea id="af-body" className="input min-h-[18rem]" value={body}
                        onChange={(e) => setBody(e.target.value)} />
              <p className="mt-0.5 text-[11px] text-maja-muted">
                Signatur wird automatisch angehängt. Die Vorlage ist unter
                Einstellungen → Auftrags-E-Mail pflegbar.
              </p>
            </div>

            <div>
              <span className="label">Anhänge (optional)</span>
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
                  + 'px-4 py-4 text-center text-sm transition '
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
                <input ref={fileInputRef} type="file" multiple accept={FILE_ACCEPT}
                       className="hidden"
                       onChange={(e) => {
                         if (e.target.files?.length) addFiles(e.target.files);
                         e.target.value = '';
                       }} />
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
                        <button type="button"
                                onClick={() => {
                                  setManualFiles((prev) => prev.filter((x) => x.id !== m.id));
                                  setAttachError(null);
                                }}
                                className="shrink-0 rounded-md p-1 text-maja-muted hover:bg-maja-navy/10 hover:text-red-600"
                                aria-label={`${m.file.name} entfernen`}>
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
        )}
      </div>
    </div>
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
          {[...filtered.fav, ...filtered.rest].map((o) => (
            <div key={norm(o.email)}
                 className="flex items-center gap-2 border-b border-maja-navy/5 px-3 py-1.5 text-sm last:border-b-0 hover:bg-maja-light/40">
              <button type="button" onClick={() => onToggleFavorit(o)}
                      className={'p-0.5 ' + (o.ist_favorit ? 'text-amber-500' : 'text-maja-muted hover:text-amber-500')}
                      aria-label={o.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}>
                <Star filled={o.ist_favorit} />
              </button>
              <button type="button"
                      onClick={() => { addTag(o.email); setOpen(false); }}
                      className="min-w-0 flex-1 text-left">
                <span className="block truncate text-maja-ink">
                  {o.name ? <span className="font-medium">{o.name} — </span> : null}
                  {o.email}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
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
