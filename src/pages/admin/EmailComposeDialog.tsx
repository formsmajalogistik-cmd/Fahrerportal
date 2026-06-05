import {
  useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent,
} from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  bodyWithSignatureHtml, signatureFromProfile,
} from '../../lib/emailSignature';
import { XIcon } from '../../components/icons';
import {
  fileToOutboundAttachment, forwardEmail, replyToEmail, sendEmailFrom,
  type OutboundAttachment,
} from '../../lib/emails';
import type { MailboxConfig } from '../../lib/mailboxSettings';

export type ComposeMode = 'new' | 'reply' | 'forward';

export interface ComposeInitial {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyHtml: string;
  /** Nur für reply/forward — Original-Message-ID. */
  messageId?: string;
}

interface Props {
  mode: ComposeMode;
  mailboxes: MailboxConfig[];
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitList(s: string): string[] {
  return s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Modal-Composer für neue Mails, Antworten und Weiterleitungen.
 * Reply / Forward laufen über die jeweiligen Graph-Endpunkte mit der
 * Original-messageId, neue Mails über /api/emails POST. Anhänge werden
 * vor dem Senden auf base64 gehoben.
 */
export function EmailComposeDialog({ mode, mailboxes, initial, onClose, onSent }: Props) {
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);
  const [from, setFrom] = useState(initial.from || mailboxes[0]?.address || '');
  const [to, setTo] = useState<string[]>(initial.to ?? []);
  const [cc, setCc] = useState<string[]>(initial.cc ?? []);
  const [ccOpen, setCcOpen] = useState((initial.cc ?? []).length > 0);
  const [subject, setSubject] = useState(initial.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml ?? '');
  const [attachments, setAttachments] = useState<OutboundAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = mode === 'reply' ? 'Antworten'
              : mode === 'forward' ? 'Weiterleiten'
              : 'Neue E-Mail';

  async function handleFiles(files: FileList | File[]) {
    const list: OutboundAttachment[] = [];
    for (const f of Array.from(files)) {
      // Hartes Limit: 4 MB Body-Limit der Vercel-Function ist
      // base64-inflated ~3 MB binär — siehe onedrive.ts. Wir nehmen
      // pro Datei höchstens 3 MB, der Admin bekommt sonst klar
      // markierten Fehler.
      if (f.size > 3 * 1024 * 1024) {
        setError(`"${f.name}" ist zu groß (max 3 MB pro Anhang).`);
        continue;
      }
      try {
        list.push(await fileToOutboundAttachment(f));
      } catch (e) {
        console.warn('[EmailComposeDialog] file -> base64', e);
      }
    }
    if (list.length > 0) setAttachments((a) => [...a, ...list]);
  }

  function removeAttachment(idx: number) {
    setAttachments((a) => a.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (to.length === 0) { setError('Mindestens ein Empfänger ist erforderlich.'); return; }
    if (mode === 'new' && !subject.trim()) {
      setError('Betreff darf nicht leer sein.');
      return;
    }
    if (!from.trim()) { setError('Postfach (Von) ist erforderlich.'); return; }
    setBusy(true);
    try {
      // Signatur an alle ausgehenden Mails anhängen (Aufgabe 1).
      // Plain-Text-Eingabe wird HTML-escaped + Zeilenumbrüche zu <br/>;
      // Forward übergibt nur einen Kommentar oberhalb der Original-Mail,
      // dort hängt Graph das Zitat selbst dran.
      const bodyWithSig = bodyWithSignatureHtml({ body: bodyHtml, sig });
      const forwardComment = bodyWithSignatureHtml({ body: bodyHtml, sig });
      if (mode === 'reply' && initial.messageId) {
        await replyToEmail({
          mailbox: from,
          messageId: initial.messageId,
          bodyHtml: bodyWithSig,
          to, cc: cc.length > 0 ? cc : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      } else if (mode === 'forward' && initial.messageId) {
        await forwardEmail({
          mailbox: from,
          messageId: initial.messageId,
          to, cc: cc.length > 0 ? cc : undefined,
          comment: forwardComment,
        });
      } else {
        await sendEmailFrom({
          mailbox: from,
          to, cc: cc.length > 0 ? cc : undefined,
          subject, bodyHtml: bodyWithSig,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Versand fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-maja-navy">{title}</h2>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div>
            <label htmlFor="cmp-from" className="label">Von</label>
            <select
              id="cmp-from"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={mode !== 'new' || mailboxes.length === 1}
            >
              {mailboxes.map((m) => (
                <option key={m.key} value={m.address}>
                  {m.address}{m.label ? ` (${m.label})` : ''}
                </option>
              ))}
            </select>
          </div>

          <ChipInput label="An" value={to} onChange={setTo} />
          {ccOpen ? (
            <ChipInput label="CC" value={cc} onChange={setCc} />
          ) : (
            <button type="button" className="text-xs font-medium text-maja-accent hover:underline"
                    onClick={() => setCcOpen(true)}>
              + CC hinzufügen
            </button>
          )}

          {mode !== 'forward' && (
            <div>
              <label htmlFor="cmp-subj" className="label">Betreff</label>
              <input
                id="cmp-subj"
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={mode === 'reply'}
              />
              {mode === 'reply' && (
                <p className="mt-0.5 text-[11px] text-maja-muted">
                  Antwort übernimmt den Original-Betreff automatisch.
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="cmp-body" className="label">
              {mode === 'forward' ? 'Anmerkung' : 'Nachricht'}
            </label>
            <textarea
              id="cmp-body"
              className="input min-h-[10rem]"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder={mode === 'forward'
                ? 'Optionaler Kommentar oberhalb der weitergeleiteten Mail …'
                : 'Nachricht eingeben …'}
            />
            <p className="mt-0.5 text-[11px] text-maja-muted">
              Einfacher Text — Zeilenumbrüche werden übernommen. Für reine
              HTML-Mails den HTML-Code direkt einfügen.
            </p>
          </div>

          {mode !== 'forward' && (
            <div>
              <label className="label">Anhänge</label>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  if (e.target.files) void handleFiles(e.target.files);
                  e.target.value = '';
                }}
                className="block text-sm"
              />
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {attachments.map((a, i) => (
                    <li key={i} className="flex items-center justify-between rounded border border-maja-navy/10 px-2 py-1 text-xs">
                      <span className="min-w-0 truncate">{a.name}</span>
                      <button type="button"
                              onClick={() => removeAttachment(i)}
                              className="rounded p-0.5 text-red-600 hover:bg-red-50"
                              aria-label="Anhang entfernen">
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
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

function ChipInput({
  label, value, onChange,
}: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('');
  const inputId = useId();
  const wrap = useRef<HTMLDivElement | null>(null);

  function addTags(raw: string) {
    const parts = splitList(raw);
    if (parts.length === 0) return;
    const present = new Set(value.map((v) => v.toLowerCase()));
    const adds: string[] = [];
    for (const p of parts) {
      if (!EMAIL_RE.test(p)) continue;
      const k = p.toLowerCase();
      if (present.has(k)) continue;
      present.add(k);
      adds.push(p);
    }
    if (adds.length > 0) onChange([...value, ...adds]);
    setInput('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (input.trim()) addTags(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  return (
    <div ref={wrap}>
      <label htmlFor={inputId} className="label">{label}</label>
      <div
        className="input flex flex-wrap items-center gap-1 px-2 py-1"
        onClick={() => document.getElementById(inputId)?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs text-maja-navy">
            {tag}
            <button type="button"
                    onClick={() => remove(tag)}
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
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (input.trim() && EMAIL_RE.test(input.trim())) addTags(input);
          }}
          placeholder={value.length === 0 ? 'E-Mail-Adresse + Enter' : ''}
        />
      </div>
    </div>
  );
}
