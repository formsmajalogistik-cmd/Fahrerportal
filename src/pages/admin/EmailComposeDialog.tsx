import {
  useMemo, useState, type FormEvent,
} from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  bodyWithSignatureHtml, signatureFromProfile,
} from '../../lib/emailSignature';
import { XIcon } from '../../components/icons';
import {
  EmailRecipientPicker, useEmailOptions,
} from '../../components/EmailRecipientPicker';
import {
  fetchAttachmentBase64, fileToOutboundAttachment, replyToEmail, sendEmailFrom,
  type MailAttachmentMeta, type OutboundAttachment,
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
  /** Forward: HTML der Original-Mail als Zitat unter dem eigenen Text. */
  quoteHtml?: string;
  /** Forward: Anhänge der Original-Mail — als Checkboxen abwählbar. */
  originalAttachments?: MailAttachmentMeta[];
  /** Forward: Postfach der Original-Mail (für den Anhang-Download). */
  originalMailbox?: string;
}

interface Props {
  mode: ComposeMode;
  mailboxes: MailboxConfig[];
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
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
  // Empfänger-Vorschläge: Favoriten + Auftraggeber (wie im Eingänge-Dialog).
  const { options, loading: optionsLoading, toggleFavorit } = useEmailOptions();
  // Forward: Original-Anhänge als an-/abwählbare Checkboxen (default: alle an).
  const originalAtts = initial.originalAttachments ?? [];
  const [selectedOriginalIds, setSelectedOriginalIds] = useState<Set<string>>(
    () => new Set(originalAtts.map((a) => a.id)),
  );
  // Forward: Original-Inhalt als Zitat — abwählbar/löschbar.
  const [includeQuote, setIncludeQuote] = useState(!!initial.quoteHtml);

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
      // Plain-Text-Eingabe wird HTML-escaped + Zeilenumbrüche zu <br/>.
      const bodyWithSig = bodyWithSignatureHtml({ body: bodyHtml, sig });
      if (mode === 'reply' && initial.messageId) {
        await replyToEmail({
          mailbox: from,
          messageId: initial.messageId,
          bodyHtml: bodyWithSig,
          to, cc: cc.length > 0 ? cc : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      } else if (mode === 'forward' && initial.messageId) {
        // Weiterleiten als kontrollierter NEU-Versand statt Graph-/forward:
        // damit sind Original-Anhänge einzeln abwählbar, eigene Dateien
        // anhängbar und das Original-Zitat löschbar.
        const fwdAttachments: OutboundAttachment[] = [...attachments];
        const srcMailbox = initial.originalMailbox || from;
        for (const att of originalAtts) {
          if (!selectedOriginalIds.has(att.id)) continue;
          const full = await fetchAttachmentBase64({
            mailbox: srcMailbox,
            messageId: initial.messageId,
            attachmentId: att.id,
          });
          fwdAttachments.push({
            name: att.name,
            contentType: full.contentType || att.contentType,
            content_base64: full.contentBytes,
          });
        }
        const quoted = includeQuote && initial.quoteHtml ? initial.quoteHtml : '';
        await sendEmailFrom({
          mailbox: from,
          to, cc: cc.length > 0 ? cc : undefined,
          subject,
          bodyHtml: `${bodyWithSig}${quoted}`,
          attachments: fwdAttachments.length > 0 ? fwdAttachments : undefined,
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

          <EmailRecipientPicker
            label="An"
            value={to}
            onChange={setTo}
            options={options}
            optionsLoading={optionsLoading}
            onToggleFavorit={(o) => void toggleFavorit(o)}
          />
          {ccOpen ? (
            <EmailRecipientPicker
              label="CC"
              value={cc}
              onChange={setCc}
              options={options}
              optionsLoading={optionsLoading}
              onToggleFavorit={(o) => void toggleFavorit(o)}
            />
          ) : (
            <button type="button" className="text-xs font-medium text-maja-accent hover:underline"
                    onClick={() => setCcOpen(true)}>
              + CC hinzufügen
            </button>
          )}

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

          <div>
            <label htmlFor="cmp-body" className="label">
              {mode === 'forward' ? 'Eigener Text' : 'Nachricht'}
            </label>
            <textarea
              id="cmp-body"
              className="input min-h-[10rem]"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder={mode === 'forward'
                ? 'Eigener Text oberhalb der weitergeleiteten Mail …'
                : 'Nachricht eingeben …'}
            />
            <p className="mt-0.5 text-[11px] text-maja-muted">
              Einfacher Text — Zeilenumbrüche werden übernommen. Signatur wird
              automatisch angehängt.
            </p>
          </div>

          {mode === 'forward' && initial.quoteHtml && (
            <div className="rounded-lg border border-maja-navy/15 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={includeQuote}
                  onChange={(e) => setIncludeQuote(e.target.checked)}
                />
                <span className="font-medium text-maja-ink">
                  Original-Nachricht als Zitat mitsenden
                </span>
              </label>
              {includeQuote && (
                <p className="mt-1 text-[11px] text-maja-muted">
                  Der weitergeleitete Inhalt wird unter deinem Text eingefügt.
                </p>
              )}
            </div>
          )}

          {mode === 'forward' && originalAtts.length > 0 && (
            <div>
              <span className="label">Original-Anhänge</span>
              <ul className="space-y-1">
                {originalAtts.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        checked={selectedOriginalIds.has(a.id)}
                        onChange={() => {
                          setSelectedOriginalIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(a.id)) next.delete(a.id);
                            else next.add(a.id);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 truncate font-medium text-maja-ink">{a.name}</span>
                      <span className="shrink-0 text-xs text-maja-muted">{a.contentType}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="label">
              {mode === 'forward' ? 'Eigene Dateien anhängen' : 'Anhänge'}
            </label>
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
