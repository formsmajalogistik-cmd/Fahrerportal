import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent,
} from 'react';
import { supabase } from '../../../lib/supabase';
import { sendEmail } from '../../../lib/onedrive';
import { useAuth } from '../../../auth/AuthContext';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../../lib/emailSignature';
import { XIcon } from '../../../components/icons';
import { formatDate, formatEuro } from '../../../lib/touren';
import { rechnungPdfFilename } from './rechnungPdf';
import { loadMailboxes, type MailboxConfig } from '../../../lib/mailboxSettings';
import type { EmailFavorit } from '../../../types/db';

interface Props {
  rechnung: {
    id: string;
    rechnungsnummer: string;
    datum: string;
    brutto_summe: number;
    auftraggeber_id: string | null;
    /** Bei manuellen Rechnungen: hinterlegte Empfänger-Adresse (088). */
    empfaenger_email?: string | null;
    pdf_url: string | null;
    belege_pdf_url: string | null;
    status: 'entwurf' | 'offen' | 'bezahlt';
  };
  onClose: () => void;
  onSent: (args: { newStatus?: 'offen' }) => void;
}

interface EmailOption {
  email: string;
  name: string | null;
  source: 'favorit' | 'auftraggeber';
  favoritId?: string;
  ist_favorit: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (s: string) => s.trim().toLowerCase();
const splitList = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);

/**
 * E-Mail-Versand-Dialog für eine Rechnung (Aufgabe 3). Empfänger werden
 * wie im Eingangs-Dialog aus Favoriten + Auftraggeber-Adressen gespeist;
 * Betreff, Body und Anhänge sind vorbefüllt aus der Rechnung. Anhänge
 * sind Rechnungs-PDF + (falls zugeordnet) Belege-PDF, beide einzeln
 * abwählbar. Body wird mit der Admin-Signatur (Aufgabe 1) gesendet.
 */
export function RechnungEmailDialog({ rechnung, onClose, onSent }: Props) {
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);

  const [options, setOptions] = useState<EmailOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  // Bei manuellen Rechnungen ist die Empfänger-Adresse Teil der
  // Rechnung — sie belegt das To-Feld vor, bleibt aber änderbar.
  const [to, setTo] = useState<string[]>(
    () => (rechnung.empfaenger_email?.trim() ? [rechnung.empfaenger_email.trim()] : []),
  );
  const [cc, setCc] = useState<string[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const [subject, setSubject] = useState(`Rechnung ${rechnung.rechnungsnummer} — Maja-Logistik`);
  const [body, setBody] = useState(defaultBody(rechnung));
  const [attachRechnung, setAttachRechnung] = useState<boolean>(!!rechnung.pdf_url);
  const [attachBelege, setAttachBelege] = useState<boolean>(!!rechnung.belege_pdf_url);
  const [setOpen, setSetOpen] = useState(rechnung.status === 'entwurf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aufgabe 3: Rechnungs-Mails standardmäßig aus mail_inbox_1 (info@).
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
    const favs: EmailFavorit[] = (favRes.data as EmailFavorit[]) ?? [];
    const byEmail = new Map<string, EmailOption>();
    for (const f of favs) {
      if (!EMAIL_RE.test(f.email)) continue;
      byEmail.set(norm(f.email), {
        email: f.email, name: f.name ?? null,
        source: 'favorit', favoritId: f.id, ist_favorit: !!f.ist_favorit,
      });
    }
    if (rechnung.auftraggeber_id) {
      const agRes = await supabase
        .from('auftraggeber')
        .select('name, email1, email2')
        .eq('id', rechnung.auftraggeber_id)
        .maybeSingle();
      type AgRow = { name: string; email1: string | null; email2: string | null };
      const ag = (agRes.data as AgRow | null) ?? null;
      if (ag) {
        const add = (email: string | null) => {
          if (!email || !EMAIL_RE.test(email.trim())) return;
          const key = norm(email);
          if (byEmail.has(key)) return;
          byEmail.set(key, {
            email: email.trim(), name: ag.name,
            source: 'auftraggeber', ist_favorit: false,
          });
        };
        add(ag.email1);
        add(ag.email2);
      }
      const kRes = await supabase
        .from('auftraggeber_kontakte')
        .select('name, email')
        .eq('auftraggeber_id', rechnung.auftraggeber_id)
        .not('email', 'is', null);
      type KRow = { name: string | null; email: string | null };
      for (const k of (kRes.data as KRow[]) ?? []) {
        if (!k.email || !EMAIL_RE.test(k.email.trim())) continue;
        const key = norm(k.email);
        if (byEmail.has(key)) continue;
        byEmail.set(key, {
          email: k.email.trim(), name: k.name ?? null,
          source: 'auftraggeber', ist_favorit: false,
        });
      }
    }
    setOptions([...byEmail.values()]);
    setOptionsLoading(false);
  }, [rechnung.auftraggeber_id]);

  useEffect(() => {
    // setState läuft async, damit der React-19-Linter
    // (set-state-in-effect) zufrieden ist.
    void Promise.resolve().then(() => { void loadOptions(); });
  }, [loadOptions]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (to.length === 0) { setError('Mindestens ein Empfänger ist erforderlich.'); return; }
    if (!attachRechnung && !attachBelege) {
      setError('Mindestens ein Anhang muss ausgewählt sein.');
      return;
    }
    setBusy(true);
    try {
      const attachments: Array<{ name: string; contentType: string; onedrive_path: string }> = [];
      if (attachRechnung && rechnung.pdf_url) {
        attachments.push({
          name: rechnungPdfFilename(rechnung.rechnungsnummer),
          contentType: 'application/pdf',
          onedrive_path: rechnung.pdf_url,
        });
      }
      if (attachBelege && rechnung.belege_pdf_url) {
        attachments.push({
          name: `Belege_${rechnung.rechnungsnummer}.pdf`,
          contentType: 'application/pdf',
          onedrive_path: rechnung.belege_pdf_url,
        });
      }
      const bodyHtml = bodyWithSignatureHtml({ body, sig });
      const result = await sendEmail({
        to, cc: cc.length > 0 ? cc : undefined,
        subject, body, bodyHtml,
        from: from || undefined,
        attachments,
      });
      if (result.missing.length > 0) {
        setError(
          `E-Mail versendet, aber ${result.missing.length} Anhang/Anhänge fehlten: `
          + `${result.missing.join(', ')}.`,
        );
      }
      // Versanddatum + ggf. Status-Bump
      const willBumpStatus = setOpen && rechnung.status === 'entwurf';
      const patch = willBumpStatus
        ? { email_versendet_am: new Date().toISOString(), status: 'offen' as const }
        : { email_versendet_am: new Date().toISOString() };
      await supabase.from('rechnungen').update(patch).eq('id', rechnung.id);
      onSent({ newStatus: willBumpStatus ? 'offen' : undefined });
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
            <h2 className="text-lg font-semibold text-maja-navy">Rechnung per E-Mail versenden</h2>
            <p className="text-xs text-maja-muted">
              {rechnung.rechnungsnummer} · {formatDate(rechnung.datum)} · {formatEuro(Number(rechnung.brutto_summe))} brutto
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
          <EmailRecipientField label="An" value={to} onChange={setTo}
                               options={options} optionsLoading={optionsLoading}
                               onToggleFavorit={toggleFavorit} />
          {ccOpen ? (
            <EmailRecipientField label="CC" value={cc} onChange={setCc}
                                 options={options} optionsLoading={optionsLoading}
                                 onToggleFavorit={toggleFavorit} />
          ) : (
            <button type="button" className="text-xs font-medium text-maja-accent hover:underline"
                    onClick={() => setCcOpen(true)}>
              + CC hinzufügen
            </button>
          )}
          <div>
            <label htmlFor="re-subject" className="label">Betreff</label>
            <input id="re-subject" className="input" value={subject}
                   onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="re-body" className="label">Nachricht</label>
            <textarea id="re-body" className="input min-h-[8rem]" value={body}
                      onChange={(e) => setBody(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-maja-muted">
              Signatur wird automatisch angehängt.
            </p>
          </div>
          <div>
            <span className="label">Anhänge</span>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                       checked={attachRechnung}
                       disabled={!rechnung.pdf_url}
                       onChange={(e) => setAttachRechnung(e.target.checked)} />
                <span className={rechnung.pdf_url ? 'font-medium text-maja-ink' : 'text-maja-muted'}>
                  Rechnungs-PDF
                </span>
                {!rechnung.pdf_url && (
                  <span className="text-[11px] text-maja-muted">(noch nicht generiert)</span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                       checked={attachBelege}
                       disabled={!rechnung.belege_pdf_url}
                       onChange={(e) => setAttachBelege(e.target.checked)} />
                <span className={rechnung.belege_pdf_url ? 'font-medium text-maja-ink' : 'text-maja-muted'}>
                  Beleg-PDF
                </span>
                {!rechnung.belege_pdf_url && (
                  <span className="text-[11px] text-maja-muted">(keine zugeordnet)</span>
                )}
              </label>
            </div>
          </div>
          {rechnung.status === 'entwurf' && (
            <label className="flex items-center gap-2 rounded-md bg-maja-light/40 px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                     checked={setOpen}
                     onChange={(e) => setSetOpen(e.target.checked)} />
              <span className="text-maja-ink">Status nach Versand auf „offen" setzen</span>
            </label>
          )}
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

function defaultBody(rechnung: { rechnungsnummer: string; datum: string; brutto_summe: number }): string {
  const brutto = formatEuro(Number(rechnung.brutto_summe));
  return (
    `Sehr geehrte Damen und Herren,\n\n`
    + `anbei erhalten Sie die Rechnung ${rechnung.rechnungsnummer} vom ${formatDate(rechnung.datum)}.\n\n`
    + `Rechnungsbetrag: ${brutto} (brutto)`
  );
}

// ---- Chip-Input mit Favoriten-Dropdown (vereinfachte Variante) ---------

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
    }
  }

  const filtered = useMemo(() => {
    const q = norm(input);
    const taken = new Set(value.map(norm));
    const visible = options
      .filter((o) => !taken.has(norm(o.email)))
      .filter((o) => !q || norm(o.email).includes(q) || (o.name && norm(o.name).includes(q)));
    return {
      fav:  visible.filter((o) =>  o.ist_favorit),
      rest: visible.filter((o) => !o.ist_favorit),
    };
  }, [options, input, value]);

  return (
    <div ref={wrap} className="relative">
      <label htmlFor={inputId} className="label">{label}</label>
      <div
        className="input flex flex-wrap items-center gap-1 px-2 py-1"
        onClick={() => document.getElementById(inputId)?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs text-maja-navy">
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
          {optionsLoading && (
            <p className="px-3 py-2 text-xs text-maja-muted">Lade Adressen …</p>
          )}
          {filtered.fav.length > 0 && (
            <div>
              <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                Favoriten
              </div>
              {filtered.fav.map((o) => (
                <Row key={`fav-${norm(o.email)}`} opt={o}
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
                <Row key={`ag-${norm(o.email)}`} opt={o}
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

function Row({
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
