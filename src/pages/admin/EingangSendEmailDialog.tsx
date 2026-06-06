import {
  useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent,
} from 'react';
import { sendEmail } from '../../lib/onedrive';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aufgabe 3: Eingangs-Mails standardmäßig aus mail_inbox_2 (protokollierung@).
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [from, setFrom] = useState<string>('');
  useEffect(() => {
    void loadMailboxes().then((mbs) => {
      const usable = mbs.filter((m) => m.address.trim() !== '');
      setMailboxes(usable);
      const def = usable.find((m) => m.key === 'mail_inbox_2') ?? usable[0];
      if (def) setFrom(def.address);
    });
  }, []);
  // Optional „Als Favorit speichern" pro NEUER Adresse beim Senden.
  // Map: normalisierte E-Mail → boolean
  const [saveAsFav, setSaveAsFav] = useState<Record<string, boolean>>({});

  function toggleAttachment(id: string) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)));
  }

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
      });
      if (result.missing.length > 0) {
        setError(
          `E-Mail versendet, aber ${result.missing.length} Anhang/Anhänge fehlten: `
          + `${result.missing.join(', ')}. PDFs ggf. neu erzeugen und erneut senden.`,
        );
      } else {
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
            <span className="label">Anhänge</span>
            {attachments.length === 0 ? (
              <p className="text-xs text-maja-muted">
                Keine PDF-Vorlagen am Template — der Versand enthält keine Anhänge.
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
