import {
  useCallback, useEffect, useState,
} from 'react';
import { Spinner } from '../../components/Spinner';
import { MailIcon } from '../../components/icons';
import {
  deleteEmail, flagEmail, formatMailDate, getEmail, listEmails, listFolders, moveEmail,
  type MailDetail, type MailFolder, type MailListItem,
} from '../../lib/emails';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import { EmailComposeDialog, type ComposeMode } from './EmailComposeDialog';
import { EmailMessageView, EmailMessageHeader } from './EmailMessageView';
import { TourFromEmailPanel } from './TourFromEmailPanel';
import { TourEditFromEmailPanel } from './TourEditFromEmailPanel';
import { TourPickerDialog } from './TourPickerDialog';

const PAGE_SIZE = 25;

type PendingTour = { mode: 'create' } | { mode: 'edit'; tourId: string };

/**
 * Posteingang — Mailbox-Pills + Ordner-Sidebar (Aufgabe 3) + Liste +
 * Detail. Tour-Aktionen (erstellen, öffnen) sind nur bei dem primären
 * Postfach (mail_inbox_1, conventionell info@) sichtbar — siehe
 * Aufgabe 4.
 */
export function PosteingangPage() {
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [mailboxLoading, setMailboxLoading] = useState(true);
  const [activeMailbox, setActiveMailbox] = useState<string>('');

  // Aktiver Ordner (Folder-ID — well-known wie "inbox" oder ein
  // beliebiger Folder aus listFolders). Default "inbox".
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string>('inbox');

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
  const [pendingTour, setPendingTour] = useState<PendingTour | null>(null);
  const [tourPicker, setTourPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Primäres Postfach = mailboxes[0] (Default / "info@"). Tour-Buttons
  // erscheinen nur dann.
  const isPrimaryMailbox = mailboxes[0]?.address === activeMailbox;

  // --- Mailboxen laden ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await loadMailboxes();
      const filled = all.filter((m) => m.address.trim() !== '');
      if (!cancelled) {
        setMailboxes(filled);
        setActiveMailbox(filled[0]?.address ?? '');
        setMailboxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Ordner pro Mailbox laden -------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      if (!activeMailbox) { setFolders([]); return; }
      setFoldersLoading(true);
      try {
        const list = await listFolders(activeMailbox);
        if (!cancelled) setFolders(list);
      } catch (err) {
        console.warn('[Posteingang] Ordner-Laden fehlgeschlagen', err);
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeMailbox]);

  // --- Liste laden -------------------------------------------------
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
        folder: activeFolderId,
      });
      setList(r.value);
      setTotalCount(r.totalCount);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Liste konnte nicht geladen werden.');
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, [activeMailbox, page, search, activeFolderId]);

  useEffect(() => {
    void Promise.resolve().then(() => { void loadList(); });
  }, [loadList]);

  // --- Detail laden -----------------------------------------------
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
    setPendingTour(null);
    setActiveFolderId('inbox');
  }

  function chooseFolder(id: string) {
    setActiveFolderId(id);
    setPage(1);
    setOpenId(null);
    setOpenMail(null);
    setPendingTour(null);
  }

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(null), 4000);
  }

  async function handleToggleFlag(m: MailListItem) {
    if (!activeMailbox) return;
    const next = !m.flagged;
    // optimistic
    setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, flagged: next } : x)));
    try {
      await flagEmail({ mailbox: activeMailbox, messageId: m.id, flagged: next });
    } catch (err) {
      setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, flagged: !next } : x)));
      showToast(err instanceof Error ? err.message : 'Flag konnte nicht gesetzt werden.');
    }
  }

  async function handleDelete(id: string) {
    if (!activeMailbox) return;
    try {
      await deleteEmail({ mailbox: activeMailbox, messageId: id });
      setList((prev) => prev.filter((x) => x.id !== id));
      if (openId === id) { setOpenId(null); setOpenMail(null); }
      showToast('In den Papierkorb verschoben.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setConfirmDelete(null);
    }
  }

  async function handleMove(id: string, destinationId: string) {
    if (!activeMailbox) return;
    try {
      await moveEmail({ mailbox: activeMailbox, messageId: id, destinationId });
      setList((prev) => prev.filter((x) => x.id !== id));
      if (openId === id) { setOpenId(null); setOpenMail(null); }
      const targetName = folders.find((f) => f.id === destinationId)?.displayName ?? 'Ordner';
      showToast(`Verschoben nach „${targetName}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Verschieben fehlgeschlagen.');
    }
  }

  // ---- Tour-Hooks (nur primäres Postfach) ----
  function openReply() {
    if (!openMail) return;
    setComposer({
      mode: 'reply',
      initial: {
        from: activeMailbox,
        to: openMail.from.address ? [openMail.from.address] : [],
        cc: [],
        subject: openMail.subject.startsWith('Re:') ? openMail.subject : `Re: ${openMail.subject}`,
        bodyHtml: '',
        messageId: openMail.id,
      },
    });
  }
  function openForward() {
    if (!openMail) return;
    setComposer({
      mode: 'forward',
      initial: {
        from: activeMailbox,
        to: [],
        cc: [],
        subject: openMail.subject.startsWith('Fwd:') ? openMail.subject : `Fwd: ${openMail.subject}`,
        bodyHtml: '',
        messageId: openMail.id,
      },
    });
  }

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

      {pendingTour && openMail ? (
        pendingTour.mode === 'create' ? (
          <TourFromEmailPanel
            mail={openMail}
            mailbox={activeMailbox}
            onClose={() => setPendingTour(null)}
            onCreated={(label) => { setPendingTour(null); showToast(`Tour erstellt: ${label}`); }}
          />
        ) : (
          <TourEditFromEmailPanel
            mail={openMail}
            mailbox={activeMailbox}
            tourId={pendingTour.tourId}
            onClose={() => setPendingTour(null)}
            onSaved={() => { setPendingTour(null); showToast('Tour gespeichert.'); }}
          />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,2fr)_minmax(0,3fr)]">
          <FolderSidebar
            folders={folders}
            loading={foldersLoading}
            activeId={activeFolderId}
            onChoose={chooseFolder}
          />
          <ListPane
            list={list}
            loading={listLoading}
            error={listError}
            search={search}
            onSearch={(s) => { setSearch(s); setPage(1); }}
            openId={openId}
            onOpen={(id) => setOpenId(id)}
            onFlag={handleToggleFlag}
            page={page}
            onPage={setPage}
            totalCount={totalCount}
          />
          <DetailPane
            mailbox={activeMailbox}
            loading={openLoading}
            error={openError}
            mail={openMail}
            isPrimary={isPrimaryMailbox}
            folders={folders}
            activeFolderId={activeFolderId}
            onReply={openReply}
            onForward={openForward}
            onCreateTour={() => setPendingTour({ mode: 'create' })}
            onOpenTour={() => setTourPicker(true)}
            onDelete={(id) => setConfirmDelete(id)}
            onMove={handleMove}
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
      {tourPicker && (
        <TourPickerDialog
          onClose={() => setTourPicker(false)}
          onPick={(tourId) => {
            setTourPicker(false);
            setPendingTour({ mode: 'edit', tourId });
          }}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmDialog
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete(confirmDelete)}
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

// ---- Ordner-Sidebar ---------------------------------------------------

function FolderSidebar({
  folders, loading, activeId, onChoose,
}: {
  folders: MailFolder[];
  loading: boolean;
  activeId: string;
  onChoose: (id: string) => void;
}) {
  // Reihenfolge: well-known zuerst (über server-listFolders bereits
  // vorsortiert), dann benutzerdefinierte alphabetisch.
  const wellKnown = folders.filter((f) => !!f.wellKnown);
  const custom = folders
    .filter((f) => !f.wellKnown)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' }));
  return (
    <div className="card flex flex-col">
      <h3 className="border-b border-maja-navy/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-maja-muted">
        Ordner
      </h3>
      {loading ? (
        <div className="p-3 text-xs text-maja-muted">Lade …</div>
      ) : (
        <ul className="divide-y divide-maja-navy/5 text-sm">
          {wellKnown.map((f) => (
            <FolderRow key={f.id} folder={f} active={isFolderActive(activeId, f)} onChoose={onChoose} />
          ))}
          {custom.length > 0 && (
            <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
              Eigene Ordner
            </li>
          )}
          {custom.map((f) => (
            <FolderRow key={f.id} folder={f} active={isFolderActive(activeId, f)} onChoose={onChoose} />
          ))}
        </ul>
      )}
    </div>
  );
}

function isFolderActive(active: string, f: MailFolder): boolean {
  return active === f.id || (!!f.wellKnown && active === f.wellKnown);
}

function FolderRow({
  folder, active, onChoose,
}: { folder: MailFolder; active: boolean; onChoose: (id: string) => void }) {
  // well-known-IDs ("inbox" etc.) verwenden, sonst die Roh-ID
  const id = folder.wellKnown ?? folder.id;
  return (
    <li>
      <button
        type="button"
        onClick={() => onChoose(id)}
        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${
          active ? 'bg-maja-navy text-white' : 'text-maja-ink hover:bg-maja-light'
        }`}
      >
        <span className="truncate">{folder.displayName || '(unbenannt)'}</span>
        {folder.unreadItemCount > 0 && (
          <span className={`rounded-full px-1.5 text-[10px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-maja-accent/20 text-maja-accent'
          }`}>
            {folder.unreadItemCount}
          </span>
        )}
      </button>
    </li>
  );
}

// ---- Liste ------------------------------------------------------------

interface ListPaneProps {
  list: MailListItem[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  openId: string | null;
  onOpen: (id: string) => void;
  onFlag: (m: MailListItem) => void;
  page: number;
  onPage: (n: number) => void;
  totalCount?: number;
}

function ListPane({
  list, loading, error, search, onSearch, openId, onOpen, onFlag, page, onPage, totalCount,
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
              <li key={m.id} className="relative">
                <button
                  type="button"
                  onClick={() => onOpen(m.id)}
                  className={`block w-full px-4 py-3 pl-9 text-left transition ${
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
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onFlag(m); }}
                  className="absolute left-2 top-3 rounded p-0.5 text-maja-muted hover:bg-maja-light"
                  aria-label={m.flagged ? 'Markierung entfernen' : 'Markieren'}
                  title={m.flagged ? 'Markierung entfernen' : 'Markieren'}
                >
                  <FlagIcon className="h-4 w-4" filled={m.flagged} />
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

// ---- Detail-Pane ------------------------------------------------------

interface DetailPaneProps {
  mailbox: string;
  loading: boolean;
  error: string | null;
  mail: MailDetail | null;
  isPrimary: boolean;
  folders: MailFolder[];
  activeFolderId: string;
  onReply: () => void;
  onForward: () => void;
  onCreateTour: () => void;
  onOpenTour: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, destinationId: string) => void;
}

function DetailPane({
  mailbox, loading, error, mail, isPrimary, folders, activeFolderId,
  onReply, onForward, onCreateTour, onOpenTour, onDelete, onMove,
}: DetailPaneProps) {
  if (loading) return <div className="card p-6"><Spinner label="E-Mail wird geladen …" /></div>;
  if (error) {
    return <div role="alert" className="card p-4 text-sm text-red-700">{error}</div>;
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
        <EmailMessageHeader mail={mail} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onReply}>Antworten</button>
          <button type="button" className="btn-secondary text-sm" onClick={onForward}>Weiterleiten</button>
          <MoveMenu
            folders={folders}
            activeFolderId={activeFolderId}
            onMove={(dst) => onMove(mail.id, dst)}
          />
          <button type="button"
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  onClick={() => onDelete(mail.id)}>
            Löschen
          </button>
          {isPrimary && (
            <>
              <button type="button" className="btn-secondary text-sm" onClick={onOpenTour}>
                Tour öffnen
              </button>
              <button type="button" className="btn-primary text-sm" onClick={onCreateTour}>
                Tour erstellen
              </button>
            </>
          )}
        </div>
      </div>
      <EmailMessageView mail={mail} mailbox={mailbox} />
    </div>
  );
}

// ---- Verschieben-Dropdown --------------------------------------------

function MoveMenu({
  folders, activeFolderId, onMove,
}: {
  folders: MailFolder[];
  activeFolderId: string;
  onMove: (destinationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        Verschieben …
      </button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-maja-navy/15 bg-white shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {folders.length === 0 && (
            <p className="px-3 py-2 text-xs text-maja-muted">Keine Ordner geladen.</p>
          )}
          {folders.map((f) => {
            const id = f.wellKnown ?? f.id;
            const isActive = id === activeFolderId;
            return (
              <button
                key={f.id}
                type="button"
                disabled={isActive}
                onClick={() => { setOpen(false); onMove(id); }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-maja-light disabled:cursor-not-allowed disabled:bg-maja-light/40 disabled:text-maja-muted`}
              >
                {f.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Delete-Confirm --------------------------------------------------

function DeleteConfirmDialog({
  onConfirm, onCancel,
}: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">E-Mail in den Papierkorb verschieben?</h3>
        <p className="mt-2 text-sm text-maja-muted">
          Die Nachricht wird in den Ordner „Papierkorb" verschoben und kann von
          dort wiederhergestellt werden.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
          <button type="button"
                  className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  onClick={onConfirm}>
            In Papierkorb verschieben
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- kleine Icons ----------------------------------------------------

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <path d="M15 9.5 8.5 16a3.5 3.5 0 0 1-5-5L10 4.5a2.5 2.5 0 0 1 3.5 3.5L7 14.5a1.5 1.5 0 0 1-2-2l6-6" />
    </svg>
  );
}

function FlagIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20"
         fill={filled ? '#f59e0b' : 'none'}
         stroke={filled ? '#d97706' : 'currentColor'}
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <path d="M5 3v14M5 4h9l-2 3 2 3H5" />
    </svg>
  );
}
