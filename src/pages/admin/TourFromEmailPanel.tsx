import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  fetchAttachmentBlob, formatBytes, formatMailDate, type MailDetail,
} from '../../lib/emails';
import { TourCreateDialog } from '../touren/TourCreateDialog';

interface Props {
  mail: MailDetail;
  mailbox: string;
  onClose: () => void;
  onCreated: (label: string) => void;
}

/**
 * Side-by-Side für "Tour aus E-Mail erstellen". Links die Mail mit
 * Body + Anhängen, rechts das eingebettete TourCreateDialog. Auf
 * schmalen Bildschirmen wird ein Tab-Toggle eingeblendet, sodass
 * nur eine Seite zur Zeit sichtbar ist.
 *
 * Der eigentliche Copy-Paste passiert manuell — der Body-Text bleibt
 * selektierbar/scrollbar; Anhänge öffnen sich in einem Inline-Viewer.
 */
export function TourFromEmailPanel({ mail, mailbox, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  const safeHtml = useMemo(() => {
    if (mail.bodyContentType === 'text') {
      return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${
        DOMPurify.sanitize(mail.bodyHtml || mail.bodyPreview)
      }</pre>`;
    }
    return DOMPurify.sanitize(mail.bodyHtml || '', {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    });
  }, [mail]);

  // Initial-Werte für das Tour-Formular: Kundennamen aus dem Absender-
  // Namen ziehen, Info-Feld mit dem Mail-Betreff vorbefüllen.
  const initial = useMemo(() => ({
    kundenname: mail.from.name ?? '',
    info: `Aus E-Mail: ${mail.subject}`,
  }), [mail]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-maja-navy">
          Tour aus E-Mail erstellen
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5 md:hidden">
            <TabButton active={tab === 'mail'} onClick={() => setTab('mail')}>E-Mail</TabButton>
            <TabButton active={tab === 'form'} onClick={() => setTab('form')}>Tour</TabButton>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Zurück zum Posteingang
          </button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${tab === 'mail' ? '' : 'hidden'} md:block`}>
          <MailPane mail={mail} mailbox={mailbox} safeHtml={safeHtml} />
        </div>
        <div className={`${tab === 'form' ? '' : 'hidden'} md:block`}>
          <TourCreateDialog
            variant="embedded"
            initial={initial}
            onClose={onClose}
            onCreated={() => {
              const label = `${initial.kundenname || 'Tour'} — ${mail.subject || 'aus E-Mail'}`;
              onCreated(label);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium ${
        active ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
      }`}
    >
      {children}
    </button>
  );
}

function MailPane({
  mail, mailbox, safeHtml,
}: { mail: MailDetail; mailbox: string; safeHtml: string }) {
  return (
    <div className="card flex h-full max-h-[80vh] flex-col p-5">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-maja-navy">
          {mail.subject || '(kein Betreff)'}
        </h3>
        <p className="mt-0.5 text-xs text-maja-muted">
          Von: <span className="text-maja-ink">
            {mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address}
          </span>
        </p>
        <p className="text-xs text-maja-muted">{formatMailDate(mail.receivedDateTime)}</p>
      </div>
      <div
        className="prose prose-sm max-w-none flex-1 overflow-y-auto border-t border-maja-navy/10 pt-3 text-sm text-maja-ink"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
      {mail.attachments.length > 0 && (
        <div className="mt-3 border-t border-maja-navy/10 pt-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maja-muted">
            Anhänge ({mail.attachments.length})
          </h4>
          <ul className="flex flex-wrap gap-2">
            {mail.attachments.map((a) => (
              <li key={a.id}>
                <AttachmentChip
                  mailbox={mailbox}
                  messageId={mail.id}
                  att={a}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({
  mailbox, messageId, att,
}: {
  mailbox: string; messageId: string;
  att: MailDetail['attachments'][number];
}) {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  async function open() {
    setBusy('view');
    try {
      const blob = await fetchAttachmentBlob({
        mailbox, messageId, attachmentId: att.id, disposition: 'inline',
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBusy(null);
    }
  }
  async function download() {
    setBusy('download');
    try {
      const blob = await fetchAttachmentBlob({
        mailbox, messageId, attachmentId: att.id, disposition: 'attachment',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = att.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setBusy(null);
    }
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-maja-navy/15 bg-white px-3 py-1 text-xs">
      <span className="truncate" title={`${att.name} (${formatBytes(att.size)})`}>
        {att.name}
      </span>
      <span className="text-maja-muted">{formatBytes(att.size)}</span>
      <button type="button" onClick={open} disabled={busy !== null}
              className="rounded px-1.5 py-0.5 text-maja-accent hover:bg-maja-light">
        {busy === 'view' ? '…' : 'Anzeigen'}
      </button>
      <button type="button" onClick={download} disabled={busy !== null}
              className="rounded px-1.5 py-0.5 text-maja-navy hover:bg-maja-light">
        {busy === 'download' ? '…' : 'Download'}
      </button>
    </span>
  );
}
