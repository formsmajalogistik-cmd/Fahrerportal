import {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import DOMPurify from 'dompurify';
import { Spinner } from '../../components/Spinner';
import { MailIcon, XIcon } from '../../components/icons';
import {
  fetchAttachmentBlob, formatBytes, formatMailDate, getEmail, listEmails,
  type MailDetail, type MailListItem,
} from '../../lib/emails';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import { EmailComposeDialog, type ComposeMode } from './EmailComposeDialog';
import { TourFromEmailPanel } from './TourFromEmailPanel';

const PAGE_SIZE = 25;

/**
 * Posteingang — zeigt die zwei konfigurierten Postfächer als Pills,
 * darunter Split-Layout mit E-Mail-Liste links + E-Mail-Detail rechts.
 * Anhänge werden über das geschützte /api/email-attachment via blob-
 * URL angezeigt; HTML-Body wird mit DOMPurify gehärtet.
 *
 * Tour-Erstellung läuft entweder als Modal (Default) oder als Side-by-
 * Side-Panel (Aufgabe 5), das die geöffnete Mail neben dem Tour-
 * Formular einblendet.
 */
export function PosteingangPage() {
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [mailboxLoading, setMailboxLoading] = useState(true);
  const [activeMailbox, setActiveMailbox] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<MailListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openMail, setOpenMail] = useState<MailDetail | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [composer, setComposer] = useState<null | {
    mode: ComposeMode;
    initial: Parameters<typeof EmailComposeDialog>[0]['initial'];
  }>(null);
  const [tourPanel, setTourPanel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Mailboxen einmal laden, ersten als aktiv setzen ----------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadMailboxes();
      const filled = list.filter((m) => m.address.trim() !== '');
      if (!cancelled) {
        setMailboxes(filled);
        setActiveMailbox(filled[0]?.address ?? '');
        setMailboxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Liste laden bei Mailbox-/Such-/Seitenwechsel ------------------
  const loadList = useCallback(async () => {
    if (!activeMailbox) { setList([]); return; }
    setListLoading(true);
    setListError(null);
    try {
      const r = await listEmails({
        mailbox: activeMailbox,
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
      });
      setList(r.value);
      setTotalCount(r.totalCount);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Liste konnte nicht geladen werden.');
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, [activeMailbox, page, search]);

  useEffect(() => {
    // Async-Wrapper, damit setState nicht synchron im Effect-Body
    // landet (React-19 set-state-in-effect-Linter).
    void Promise.resolve().then(() => { void loadList(); });
  }, [loadList]);

  // Detail laden, sobald openId gesetzt ist.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      if (!openId || !activeMailbox) { setOpenMail(null); return; }
      setOpenLoading(true);
      setOpenError(null);
      try {
        const m = await getEmail(activeMailbox, openId);
        if (!cancelled) setOpenMail(m);
      } catch (err) {
        if (!cancelled) setOpenError(err instanceof Error ? err.message : 'Mail konnte nicht geladen werden.');
      } finally {
        if (!cancelled) setOpenLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openId, activeMailbox]);

  function chooseMailbox(addr: string) {
    setActiveMailbox(addr);
    setPage(1);
    setOpenId(null);
    setOpenMail(null);
    setTourPanel(false);
  }

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(null), 4000);
  }

  // ---- UI ------------------------------------------------------------
  if (mailboxLoading) return <Spinner label="Postfächer werden geladen …" />;

  if (mailboxes.length === 0) {
    return (
      <div className="card p-6 text-sm text-maja-muted">
        Noch kein Postfach hinterlegt. Bitte unter{' '}
        <a className="font-medium text-maja-accent underline" href="/einstellungen/postfaecher">
          Einstellungen &gt; E-Mail-Postfächer
        </a>{' '}konfigurieren.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Posteingang</h1>
          <p className="text-sm text-maja-muted">
            Beide Postfächer in einer Ansicht — E-Mails lesen, antworten,
            weiterleiten oder direkt eine Tour aus einer Anfrage erstellen.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setComposer({
            mode: 'new',
            initial: { from: activeMailbox, to: [], cc: [], subject: '', bodyHtml: '' },
          })}
        >
          + Neue E-Mail
        </button>
      </div>

      {/* Mailbox-Pills */}
      <div className="flex flex-wrap items-center gap-1">
        {mailboxes.map((m) => {
          const active = m.address === activeMailbox;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => chooseMailbox(m.address)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? 'bg-maja-navy text-white'
                  : 'bg-white text-maja-navy border border-maja-navy/15 hover:bg-maja-light'
              }`}
            >
              <MailIcon className="h-3.5 w-3.5" />
              {m.address}{m.label ? ` (${m.label})` : ''}
            </button>
          );
        })}
      </div>

      {tourPanel && openMail ? (
        <TourFromEmailPanel
          mail={openMail}
          mailbox={activeMailbox}
          onClose={() => setTourPanel(false)}
          onCreated={(label) => { setTourPanel(false); showToast(`Tour erstellt: ${label}`); }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ListPane
            list={list}
            loading={listLoading}
            error={listError}
            search={search}
            onSearch={(s) => { setSearch(s); setPage(1); }}
            openId={openId}
            onOpen={(id) => setOpenId(id)}
            page={page}
            onPage={setPage}
            totalCount={totalCount}
          />
          <DetailPane
            mailbox={activeMailbox}
            loading={openLoading}
            error={openError}
            mail={openMail}
            onReply={() => {
              if (!openMail) return;
              setComposer({
                mode: 'reply',
                initial: {
                  from: activeMailbox,
                  to: openMail.from.address ? [openMail.from.address] : [],
                  cc: [],
                  subject: openMail.subject.startsWith('Re:')
                    ? openMail.subject
                    : `Re: ${openMail.subject}`,
                  bodyHtml: '',
                  messageId: openMail.id,
                },
              });
            }}
            onForward={() => {
              if (!openMail) return;
              setComposer({
                mode: 'forward',
                initial: {
                  from: activeMailbox,
                  to: [],
                  cc: [],
                  subject: openMail.subject.startsWith('Fwd:')
                    ? openMail.subject
                    : `Fwd: ${openMail.subject}`,
                  bodyHtml: '',
                  messageId: openMail.id,
                },
              });
            }}
            onCreateTour={() => setTourPanel(true)}
          />
        </div>
      )}

      {composer && (
        <EmailComposeDialog
          mode={composer.mode}
          mailboxes={mailboxes}
          initial={composer.initial}
          onClose={() => setComposer(null)}
          onSent={() => {
            setComposer(null);
            showToast(composer.mode === 'reply' ? 'Antwort verschickt.'
              : composer.mode === 'forward' ? 'Weitergeleitet.'
              : 'E-Mail verschickt.');
            void loadList();
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---- Linke Spalte: Liste ----------------------------------------------

interface ListPaneProps {
  list: MailListItem[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  openId: string | null;
  onOpen: (id: string) => void;
  page: number;
  onPage: (n: number) => void;
  totalCount?: number;
}

function ListPane({
  list, loading, error, search, onSearch, openId, onOpen, page, onPage, totalCount,
}: ListPaneProps) {
  return (
    <div className="card flex min-h-[24rem] flex-col">
      <div className="border-b border-maja-navy/10 p-3">
        <input
          className="input"
          type="search"
          placeholder="Suche: Betreff oder Absender …"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {error && (
        <div role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <div className="p-4"><Spinner label="E-Mails werden geladen …" /></div>
      ) : list.length === 0 ? (
        <p className="p-6 text-center text-sm text-maja-muted">Keine E-Mails gefunden.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-maja-navy/5">
          {list.map((m) => {
            const active = m.id === openId;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpen(m.id)}
                  className={`block w-full px-4 py-3 text-left transition ${
                    active ? 'bg-maja-light' : 'hover:bg-maja-light/40'
                  } ${!m.isRead ? 'bg-blue-50/30' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate text-sm ${!m.isRead ? 'font-semibold text-maja-navy' : 'text-maja-ink'}`}>
                      {m.from.name || m.from.address || '—'}
                    </span>
                    <span className="shrink-0 text-xs text-maja-muted">
                      {formatMailDate(m.receivedDateTime)}
                    </span>
                  </div>
                  <div className={`mt-0.5 truncate text-sm ${!m.isRead ? 'font-semibold text-maja-ink' : 'text-maja-ink'}`}>
                    {m.subject || '(kein Betreff)'}
                    {m.hasAttachments && <PaperclipIcon className="ml-1 inline h-3 w-3 text-maja-muted" />}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-maja-muted">
                    {m.bodyPreview}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-maja-navy/10 p-2 text-xs text-maja-muted">
        <span>
          {totalCount != null ? `${totalCount} E-Mails` : `Seite ${page}`}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-maja-light disabled:opacity-40"
            disabled={page <= 1 || loading}
            onClick={() => onPage(page - 1)}
          >
            Zurück
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-maja-light disabled:opacity-40"
            disabled={loading || list.length < PAGE_SIZE}
            onClick={() => onPage(page + 1)}
          >
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Rechte Spalte: Detail --------------------------------------------

interface DetailPaneProps {
  mailbox: string;
  loading: boolean;
  error: string | null;
  mail: MailDetail | null;
  onReply: () => void;
  onForward: () => void;
  onCreateTour: () => void;
}

function DetailPane({
  mailbox, loading, error, mail, onReply, onForward, onCreateTour,
}: DetailPaneProps) {
  if (loading) return <div className="card p-6"><Spinner label="E-Mail wird geladen …" /></div>;
  if (error) {
    return (
      <div role="alert" className="card p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!mail) {
    return (
      <div className="card flex items-center justify-center p-12 text-sm text-maja-muted">
        Wähle links eine E-Mail aus.
      </div>
    );
  }
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-maja-navy">
            {mail.subject || '(kein Betreff)'}
          </h2>
          <p className="mt-0.5 text-xs text-maja-muted">
            Von: <span className="text-maja-ink">{mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address}</span>
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
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onReply}>Antworten</button>
          <button type="button" className="btn-secondary text-sm" onClick={onForward}>Weiterleiten</button>
          <button type="button" className="btn-primary text-sm" onClick={onCreateTour}>Tour erstellen</button>
        </div>
      </div>
      <MailBody mail={mail} />
      {mail.attachments.length > 0 && (
        <Attachments mailbox={mailbox} messageId={mail.id} attachments={mail.attachments} />
      )}
    </div>
  );
}

// ---- Subkomponenten ----------------------------------------------------

function MailBody({ mail }: { mail: MailDetail }) {
  const safe = useMemo(() => {
    if (mail.bodyContentType === 'text') {
      // Plain-Text → minimal-Whitespace-preserve.
      return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${
        DOMPurify.sanitize(mail.bodyHtml || mail.bodyPreview)
      }</pre>`;
    }
    return DOMPurify.sanitize(mail.bodyHtml || '', {
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'class', 'colspan', 'rowspan', 'width', 'height', 'border', 'cellspacing', 'cellpadding'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    });
  }, [mail]);
  return (
    <div
      className="prose prose-sm max-w-none overflow-x-auto border-t border-maja-navy/10 pt-4 text-sm text-maja-ink"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

function Attachments({
  mailbox, messageId, attachments,
}: {
  mailbox: string; messageId: string; attachments: MailDetail['attachments'];
}) {
  return (
    <div className="border-t border-maja-navy/10 pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maja-muted">
        Anhänge ({attachments.length})
      </h3>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <li key={a.id}>
            <AttachmentChip mailbox={mailbox} messageId={messageId} att={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttachmentChip({
  mailbox, messageId, att,
}: {
  mailbox: string; messageId: string;
  att: { id: string; name: string; contentType: string; size: number };
}) {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function open() {
    setBusy('view');
    try {
      const blob = await fetchAttachmentBlob({
        mailbox, messageId, attachmentId: att.id, disposition: 'inline',
      });
      const url = URL.createObjectURL(blob);
      setPreview(url);
    } catch (e) {
      alert(`Anhang konnte nicht geöffnet werden: ${e instanceof Error ? e.message : e}`);
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
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(`Download fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-2 rounded-full border border-maja-navy/15 bg-white px-3 py-1 text-xs">
        <PaperclipIcon className="h-3 w-3 text-maja-muted" />
        <span className="truncate" title={`${att.name} (${formatBytes(att.size)})`}>
          {att.name}
        </span>
        <span className="text-maja-muted">{formatBytes(att.size)}</span>
        <button
          type="button"
          onClick={open}
          disabled={busy !== null}
          className="rounded px-1.5 py-0.5 text-maja-accent hover:bg-maja-light"
        >
          {busy === 'view' ? '…' : 'Anzeigen'}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={busy !== null}
          className="rounded px-1.5 py-0.5 text-maja-navy hover:bg-maja-light"
        >
          {busy === 'download' ? '…' : 'Download'}
        </button>
      </span>
      {preview && (
        <PreviewModal
          url={preview}
          name={att.name}
          contentType={att.contentType}
          onClose={() => {
            URL.revokeObjectURL(preview);
            setPreview(null);
          }}
        />
      )}
    </>
  );
}

function PreviewModal({
  url, name, contentType, onClose,
}: { url: string; name: string; contentType: string; onClose: () => void }) {
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/60 p-4">
      <div className="card flex h-[90vh] w-full max-w-5xl flex-col">
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
              Vorschau für {contentType} nicht möglich — bitte herunterladen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <path d="M15 9.5 8.5 16a3.5 3.5 0 0 1-5-5L10 4.5a2.5 2.5 0 0 1 3.5 3.5L7 14.5a1.5 1.5 0 0 1-2-2l6-6" />
    </svg>
  );
}
