import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { XIcon } from '../../components/icons';
import {
  fetchAttachmentBlob, formatBytes, formatMailDate, type MailDetail,
} from '../../lib/emails';
import { enrichBodyWithInlineImages } from '../../lib/inlineImages';

interface Props {
  mail: MailDetail;
  mailbox: string;
}

/**
 * Ganze Konversation untereinander — für die Side-by-Side-Panels
 * (Tour aus E-Mail, Zusätze/Belege). Jede Nachricht als eigene Card
 * mit Header, Body und Anhängen; eigene (gesendete) Nachrichten
 * erhalten ein „Gesendet"-Badge. Scrollen übernimmt der Eltern-
 * Container der Panels.
 */
export function EmailThreadView({
  thread, mailbox, ownAddresses,
}: {
  thread: MailDetail[];
  mailbox: string;
  ownAddresses?: string[];
}) {
  const own = (ownAddresses ?? []).map((a) => a.toLowerCase());
  return (
    <div className="space-y-3">
      {thread.map((m) => {
        const isOwn = own.includes((m.from.address ?? '').toLowerCase());
        return (
          <div key={m.id} className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <EmailMessageHeader mail={m} />
              {isOwn && (
                <span className="inline-flex shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                  Gesendet
                </span>
              )}
            </div>
            <EmailMessageView mail={m} mailbox={mailbox} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Header-Block einer E-Mail (Betreff + From/To/CC/Datum). Wird sowohl
 * im Posteingang-Detail als auch in den Side-by-Side-Panels verwendet,
 * damit dieselbe Optik überall greift.
 */
export function EmailMessageHeader({ mail }: { mail: MailDetail }) {
  return (
    <div className="min-w-0 flex-1">
      <h2 className="text-lg font-semibold text-maja-navy">
        {mail.subject || '(kein Betreff)'}
      </h2>
      <p className="mt-0.5 text-xs text-maja-muted">
        Von: <span className="text-maja-ink">
          {mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address}
        </span>
      </p>
      <p className="text-xs text-maja-muted">
        An: <span className="text-maja-ink">{mail.to.map((t) => t.address).filter(Boolean).join(', ')}</span>
      </p>
      {mail.cc.length > 0 && (
        <p className="text-xs text-maja-muted">
          CC: <span className="text-maja-ink">{mail.cc.map((t) => t.address).filter(Boolean).join(', ')}</span>
        </p>
      )}
      <p className="text-xs text-maja-muted">
        {formatMailDate(mail.receivedDateTime)}
      </p>
    </div>
  );
}

/**
 * E-Mail-Body (sanitized) + alle Anhänge als Inline-Vorschau (Aufgabe 2).
 * PDFs werden in einem iframe mit fester Höhe gerendert, Bilder als
 * <img>, andere Dateien nur mit Name + Größe + Download. Vollbild-Klick
 * öffnet ein Modal (keinen neuen Tab).
 */
export function EmailMessageView({ mail, mailbox }: Props) {
  // Body, der angezeigt wird. Default = Original; der Inline-Bild-
  // Helper schreibt eine angereicherte Version DARÜBER. Bei Fehlern
  // bleibt der Original-Body stehen.
  const [displayBody, setDisplayBody] = useState<string>(mail.bodyHtml || '');
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setDisplayBody(mail.bodyHtml || '');
    });
    if (mail.bodyContentType !== 'html') return () => { cancelled = true; };
    if (!mail.bodyHtml || !mail.bodyHtml.includes('cid:')) return () => { cancelled = true; };
    void enrichBodyWithInlineImages(mail.bodyHtml, mail.attachments, mailbox, mail.id)
      .then((next) => {
        if (cancelled) return;
        if (next && next !== mail.bodyHtml) setDisplayBody(next);
      })
      .catch(() => { /* Fallback bleibt der Original-Body. */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.id]);

  const safe = useMemo(() => {
    if (mail.bodyContentType === 'text') {
      return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${
        DOMPurify.sanitize(displayBody || mail.bodyPreview)
      }</pre>`;
    }
    return DOMPurify.sanitize(displayBody || '', {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      // data:image/...;base64 muss durch — Inline-Bilder werden lokal
      // in den Body geschrieben (siehe inlineImages.ts).
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data:image\/[a-z0-9+.-]+;base64,):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
  }, [displayBody, mail.bodyContentType, mail.bodyPreview]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        className="prose prose-sm max-w-none overflow-x-auto border-t border-maja-navy/10 pt-4 text-sm text-maja-ink"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {mail.attachments.length > 0 && (
        <div className="border-t border-maja-navy/10 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-maja-muted">
            Anhänge ({mail.attachments.length})
          </h3>
          <div className="space-y-4">
            {mail.attachments.map((a) => (
              <InlineAttachment
                key={a.id}
                mailbox={mailbox}
                messageId={mail.id}
                att={a}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface AttProps {
  mailbox: string;
  messageId: string;
  att: MailDetail['attachments'][number];
}

function InlineAttachment({ mailbox, messageId, att }: AttProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const isImage = att.contentType.startsWith('image/');
  const isPdf = att.contentType === 'application/pdf';

  // Blob-URL erst dann holen, wenn der Anhang inline darstellbar ist;
  // andere Dateitypen (.docx etc.) lassen wir lazy und reichen nur
  // einen Download-Button durch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      if (!isImage && !isPdf) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const blob = await fetchAttachmentBlob({
          mailbox, messageId, attachmentId: att.id, disposition: 'inline',
        });
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        setUrl(u);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Anhang konnte nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailbox, messageId, att.id, isImage, isPdf]);

  async function download() {
    try {
      const blob = await fetchAttachmentBlob({
        mailbox, messageId, attachmentId: att.id, disposition: 'attachment',
      });
      const dUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dUrl; a.download = att.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(dUrl), 5000);
    } catch (e) {
      alert(`Download fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <>
      <div className="rounded-lg border border-maja-navy/10 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-maja-navy/10 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-maja-ink" title={att.name}>
              {att.name}
            </p>
            <p className="text-xs text-maja-muted">
              {att.contentType} · {formatBytes(att.size)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(isImage || isPdf) && url && (
              <button type="button" onClick={() => setFullscreen(true)}
                      className="rounded-md border border-maja-navy/20 bg-white px-3 py-1 text-xs font-medium text-maja-navy hover:bg-maja-light">
                Vollbild
              </button>
            )}
            <button type="button" onClick={download}
                    className="rounded-md bg-maja-navy px-3 py-1 text-xs font-medium text-white hover:bg-maja-accent">
              Herunterladen
            </button>
          </div>
        </div>
        <div className="p-2">
          {loading && (
            <p className="px-3 py-6 text-center text-xs text-maja-muted">Anhang wird geladen …</p>
          )}
          {!loading && error && (
            <p className="px-3 py-3 text-xs text-red-700">{error}</p>
          )}
          {!loading && !error && url && isImage && (
            <button type="button" onClick={() => setFullscreen(true)} className="block w-full">
              <img
                src={url}
                alt={att.name}
                className="mx-auto max-h-[480px] max-w-full rounded object-contain"
              />
            </button>
          )}
          {!loading && !error && url && isPdf && (
            <iframe
              title={att.name}
              src={url}
              className="h-[500px] w-full rounded border-0"
            />
          )}
          {!loading && !error && !isImage && !isPdf && (
            <p className="px-3 py-3 text-xs text-maja-muted">
              Vorschau für {att.contentType} nicht möglich — bitte herunterladen.
            </p>
          )}
        </div>
      </div>
      {fullscreen && url && (
        <FullscreenPreview
          url={url}
          name={att.name}
          contentType={att.contentType}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
}

function FullscreenPreview({
  url, name, contentType, onClose,
}: { url: string; name: string; contentType: string; onClose: () => void }) {
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-maja-ink/70 p-4">
      <div className="card flex h-[92vh] w-full max-w-6xl flex-col">
        <div className="flex items-center justify-between border-b border-maja-navy/10 p-3">
          <h4 className="truncate text-sm font-semibold text-maja-navy">{name}</h4>
          <button type="button" onClick={onClose}
                  className="rounded p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-maja-light/30 p-2">
          {isImage ? (
            <img src={url} alt={name} className="mx-auto max-h-full max-w-full object-contain" />
          ) : isPdf ? (
            <iframe title={name} src={url} className="h-full w-full border-0" />
          ) : (
            <p className="p-6 text-center text-sm text-maja-muted">
              Vollbild nicht verfügbar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
