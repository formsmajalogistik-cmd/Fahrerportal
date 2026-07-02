import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Spinner } from '../../components/Spinner';
import { MailIcon } from '../../components/icons';
import {
  deleteEmail, formatMailDate, getEmail, listEmails, listFolders,
  markEmailRead, moveEmail, setFlagStatus, NEXT_FLAG_STATUS,
  type FlagStatus, type MailDetail, type MailFolder, type MailListItem,
} from '../../lib/emails';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import { EmailComposeDialog, type ComposeMode } from './EmailComposeDialog';
import { EmailMessageView, EmailMessageHeader } from './EmailMessageView';
import { TourFromEmailPanel } from './TourFromEmailPanel';
import { TourEditFromEmailPanel } from './TourEditFromEmailPanel';
import { TourPickerDialog } from './TourPickerDialog';
import { ZusaetzeFromEmailPanel } from './ZusaetzeFromEmailPanel';

// API-Seitengröße — wir laden mehr als angezeigt, damit nach dem
// clientseitigen Klassifizierungs-Filter (Relevant/Sonstige) genug für
// die Anzeige-Seitengröße übrig ist.
const API_PAGE_SIZE = 100;
const DISPLAY_PAGE_SIZE = 25;

type PendingTour =
  | { mode: 'create' }
  | { mode: 'edit'; tourId: string }
  | { mode: 'zusaetze'; tourId: string }
  | { mode: 'zusaetze-belege'; tourId: string };

/**
 * Gruppiert E-Mails nach Graph-conversationId zu Threads (Outlook-
 * Konversationsansicht). Mails ohne conversationId bleiben Einzel-
 * Threads. Innerhalb eines Threads: älteste zuerst. Threads selbst:
 * nach der NEUESTEN Mail absteigend sortiert.
 */
function groupByConversation(emails: MailListItem[]): MailListItem[][] {
  const threads = new Map<string, MailListItem[]>();
  for (const m of emails) {
    const key = m.conversationId ?? `single:${m.id}`;
    const arr = threads.get(key);
    if (arr) arr.push(m);
    else threads.set(key, [m]);
  }
  const out = Array.from(threads.values());
  for (const t of out) {
    t.sort((a, b) => (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''));
  }
  out.sort((a, b) =>
    (b[b.length - 1].receivedDateTime || '').localeCompare(a[a.length - 1].receivedDateTime || ''));
  return out;
}

/** Stabiler Schlüssel eines Threads (conversationId oder Einzel-Mail-ID). */
function threadKey(thread: MailListItem[]): string {
  return thread[0].conversationId ?? `single:${thread[0].id}`;
}

/** Welcher Picker-Workflow wartet auf eine Tour-Auswahl? */
type PickerPurpose = 'open' | 'zusaetze' | 'zusaetze-belege';

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
  /** Inkrement löst ein Neu-Laden der Ordner-Liste aus (Refresh-Button). */
  const [folderReload, setFolderReload] = useState(0);

  const [search, setSearch] = useState('');
  // Anzeige-Pagination (clientseitig, in DISPLAY_PAGE_SIZE-Schritten).
  const [page, setPage] = useState(1);
  // Akkumulierte Liste über alle bislang geladenen API-Seiten —
  // notwendig, damit nach dem Klassifizierungs-Filter (Relevant/Sonstige)
  // genug Einträge für eine UI-Seite übrig bleiben. Pagination zieht
  // sich daraus, neue API-Seiten werden bei Bedarf nachgeladen.
  const [list, setList] = useState<MailListItem[]>([]);
  const [apiPage, setApiPage] = useState(1);
  const [hasMoreFromApi, setHasMoreFromApi] = useState(true);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Focused Inbox: clientseitiges Filtern, weil
  // `$filter=inferenceClassification ...` mit $orderby (InefficientFilter)
  // und mit $search (SearchWithFilter) kollidiert. Tabs werden nur im
  // Posteingang-Ordner gezeigt UND nur, wenn die geladene Liste
  // mindestens eine Mail mit klassifizierungs-tag enthält (Konten ohne
  // Focused Inbox liefern für jede Mail `inferenceClassification=null`).
  const [classification, setClassification] = useState<'focused' | 'other'>('focused');

  const [openId, setOpenId] = useState<string | null>(null);
  const [openMail, setOpenMail] = useState<MailDetail | null>(null);
  /** Alle Nachrichten der geöffneten Konversation (chronologisch),
   *  null wenn die Mail ein Einzel-Thread ist. */
  const [openThread, setOpenThread] = useState<MailDetail[] | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [composer, setComposer] = useState<null | {
    mode: ComposeMode;
    initial: Parameters<typeof EmailComposeDialog>[0]['initial'];
  }>(null);
  const [pendingTour, setPendingTour] = useState<PendingTour | null>(null);
  const [tourPicker, setTourPicker] = useState<PickerPurpose | null>(null);
  /** Lösch-Bestätigung für eine ganze Konversation (alle IDs im aktuellen
   *  Ordner). null = kein Dialog offen. */
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
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
  }, [activeMailbox, folderReload]);

  // --- Liste laden -------------------------------------------------
  // Erste API-Seite holen, akkumulierte Liste resetten. Wird ausgelöst,
  // sobald Mailbox / Ordner / Suche / Klassifizierung wechseln.
  const loadFirstPage = useCallback(async () => {
    if (!activeMailbox) {
      setList([]);
      setApiPage(1);
      setHasMoreFromApi(false);
      setTotalCount(undefined);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const r = await listEmails({
        mailbox: activeMailbox,
        page: 1,
        pageSize: API_PAGE_SIZE,
        search: search.trim() || undefined,
        folder: activeFolderId,
      });
      setList(r.value);
      setApiPage(1);
      setHasMoreFromApi(r.value.length >= API_PAGE_SIZE);
      setTotalCount(r.totalCount);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Liste konnte nicht geladen werden.');
      setList([]);
      setHasMoreFromApi(false);
    } finally {
      setListLoading(false);
    }
  }, [activeMailbox, search, activeFolderId]);

  useEffect(() => {
    void Promise.resolve().then(() => { void loadFirstPage(); });
  }, [loadFirstPage]);

  // --- Weitere API-Seite nachladen ---------------------------------
  // Hängt eine Seite an `list` an und stoppt, wenn Graph weniger als
  // API_PAGE_SIZE liefert (= keine weiteren Seiten mehr).
  const loadMoreFromApi = useCallback(async () => {
    if (!activeMailbox || !hasMoreFromApi || listLoading) return;
    setListLoading(true);
    setListError(null);
    try {
      const nextApi = apiPage + 1;
      const r = await listEmails({
        mailbox: activeMailbox,
        page: nextApi,
        pageSize: API_PAGE_SIZE,
        search: search.trim() || undefined,
        folder: activeFolderId,
      });
      setList((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = r.value.filter((m) => !seen.has(m.id));
        return [...prev, ...fresh];
      });
      setApiPage(nextApi);
      setHasMoreFromApi(r.value.length >= API_PAGE_SIZE);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Liste konnte nicht geladen werden.');
    } finally {
      setListLoading(false);
    }
  }, [activeMailbox, hasMoreFromApi, listLoading, apiPage, search, activeFolderId]);

  // --- Focused-Inbox: clientseitiges Filtern + Badge-Counts -------
  const classificationSupported = activeFolderId === 'inbox'
    && list.some((m) => m.inferenceClassification != null);
  const showClassificationTabs = classificationSupported;
  const filteredList = useMemo(() => {
    if (!showClassificationTabs) return list;
    return list.filter((m) => m.inferenceClassification === classification);
  }, [list, showClassificationTabs, classification]);
  // Threads gruppieren + Anzeige-Seite aus den Threads schneiden —
  // paginiert wird in Konversationen, nicht in Einzel-Mails.
  const threads = useMemo(() => groupByConversation(filteredList), [filteredList]);
  const visibleThreads = useMemo(() => {
    const start = (page - 1) * DISPLAY_PAGE_SIZE;
    return threads.slice(start, start + DISPLAY_PAGE_SIZE);
  }, [threads, page]);
  // Falls die aktuelle Seite kein „Sichtfeld voll" liefert UND die API
  // noch weitere Seiten hat: automatisch nachladen, bis genug
  // gefilterte Threads da sind oder die API erschöpft ist.
  useEffect(() => {
    if (listLoading || !hasMoreFromApi) return;
    const needed = page * DISPLAY_PAGE_SIZE;
    if (threads.length >= needed) return;
    void Promise.resolve().then(() => { void loadMoreFromApi(); });
  }, [page, threads.length, hasMoreFromApi, listLoading, loadMoreFromApi]);
  const focusedUnread = useMemo(
    () => (showClassificationTabs
      ? list.filter((m) => m.inferenceClassification === 'focused' && !m.isRead).length
      : 0),
    [list, showClassificationTabs],
  );
  const otherUnread = useMemo(
    () => (showClassificationTabs
      ? list.filter((m) => m.inferenceClassification === 'other' && !m.isRead).length
      : 0),
    [list, showClassificationTabs],
  );
  // „Weiter"-Button aktiv, wenn entweder gefilterte Threads für die
  // nächste Seite vorliegen ODER die API noch nicht erschöpft ist.
  const hasNextPage = threads.length > page * DISPLAY_PAGE_SIZE || hasMoreFromApi;

  // Eigene Absende-Adressen — für „Gesendet"-Badges in Thread-Liste
  // und -Detail.
  const ownAddresses = useMemo(
    () => mailboxes.map((m) => m.address.trim().toLowerCase()).filter(Boolean),
    [mailboxes],
  );

  // --- Detail laden -----------------------------------------------
  // Bei Threads (mehrere Mails mit derselben conversationId) werden
  // ALLE Nachrichten der Konversation geladen und chronologisch im
  // rechten Panel gerendert. listRef vermeidet, dass der Effekt bei
  // jedem Listen-Reload neu feuert.
  const listRef = useRef<MailListItem[]>([]);
  useEffect(() => { listRef.current = list; }, [list]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      if (!openId || !activeMailbox) { setOpenMail(null); setOpenThread(null); return; }
      setOpenLoading(true);
      setOpenError(null);
      try {
        const cur = listRef.current.find((m) => m.id === openId);
        const convId = cur?.conversationId ?? null;
        const threadItems = convId
          ? listRef.current.filter((m) => m.conversationId === convId)
          : [];
        const ids = threadItems.length > 1 ? threadItems.map((m) => m.id) : [openId];
        const details = await Promise.all(ids.map((id) => getEmail(activeMailbox, id)));
        if (cancelled) return;
        details.sort((a, b) =>
          (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''));
        setOpenThread(details.length > 1 ? details : null);
        setOpenMail(details.find((d) => d.id === openId) ?? details[0] ?? null);

        // Aufgabe 1: ungelesene Nachrichten in dieser Konversation
        // sofort im Hintergrund als gelesen markieren — kein await auf
        // den Anzeige-Pfad, kein Loading-Indikator. Wird der Component
        // entladen, schluckt der cancelled-Guard die UI-Updates.
        const unreadIds = details.filter((d) => !d.isRead).map((d) => d.id);
        if (unreadIds.length > 0) {
          // optimistic: list-State sofort updaten, damit Fett/Counter
          // verschwindet.
          setList((prev) => prev.map((m) =>
            unreadIds.includes(m.id) ? { ...m, isRead: true } : m,
          ));
          void Promise.all(unreadIds.map((id) =>
            markEmailRead({ mailbox: activeMailbox, messageId: id, isRead: true })
              .catch((err) => {
                console.warn('[Posteingang] markRead fehlgeschlagen', id, err);
              }),
          ));
        }
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
    setOpenThread(null);
    setPendingTour(null);
    setActiveFolderId('inbox');
    setClassification('focused');
  }

  function chooseFolder(id: string) {
    setActiveFolderId(id);
    setPage(1);
    setOpenId(null);
    setOpenMail(null);
    setOpenThread(null);
    setPendingTour(null);
    setClassification('focused');
  }

  function chooseClassification(c: 'focused' | 'other') {
    setClassification(c);
    setPage(1);
    setOpenId(null);
    setOpenMail(null);
    setOpenThread(null);
  }

  /** Aufgabe 1: Liste + Ordner-Counts neu laden (Refresh-Button). */
  function refreshAll() {
    setPage(1);
    setFolderReload((k) => k + 1);
    void loadFirstPage();
  }

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(null), 4000);
  }

  // Drei-Status-Markierung (Outlook): notFlagged → flagged → complete → …
  async function handleToggleFlag(m: MailListItem) {
    if (!activeMailbox) return;
    const prevStatus = m.flagStatus ?? (m.flagged ? 'flagged' : 'notFlagged');
    const next = NEXT_FLAG_STATUS[prevStatus];
    // optimistic
    setList((prev) => prev.map((x) => (
      x.id === m.id ? { ...x, flagStatus: next, flagged: next === 'flagged' } : x
    )));
    try {
      await setFlagStatus({ mailbox: activeMailbox, messageId: m.id, flagStatus: next });
    } catch (err) {
      setList((prev) => prev.map((x) => (
        x.id === m.id ? { ...x, flagStatus: prevStatus, flagged: prevStatus === 'flagged' } : x
      )));
      showToast(err instanceof Error ? err.message : 'Markierung konnte nicht gesetzt werden.');
    }
  }

  /** Lösch-Anforderung: ermittelt ALLE Nachrichten der Konversation im
   *  aktuell geladenen Ordner und öffnet den Bestätigungsdialog. */
  function requestDelete(id: string) {
    const clicked = list.find((m) => m.id === id);
    const convId = clicked?.conversationId ?? null;
    const ids = convId
      ? list.filter((m) => m.conversationId === convId).map((m) => m.id)
      : [id];
    // Sicherstellen, dass die geklickte ID enthalten ist (falls nicht in
    // der Liste — z.B. Detail aus Thread-Nachladung).
    setConfirmDelete({ ids: ids.includes(id) ? ids : [id] });
  }

  async function handleDelete(ids: string[]) {
    if (!activeMailbox || ids.length === 0) return;
    try {
      // Ganze Konversation parallel in den Papierkorb.
      const results = await Promise.allSettled(
        ids.map((id) => deleteEmail({ mailbox: activeMailbox, messageId: id })),
      );
      const okIds = ids.filter((_, i) => results[i].status === 'fulfilled');
      const failed = results.length - okIds.length;
      setList((prev) => prev.filter((x) => !okIds.includes(x.id)));
      if (openId && okIds.includes(openId)) {
        setOpenId(null); setOpenMail(null); setOpenThread(null);
      }
      if (failed > 0) {
        showToast(`${okIds.length} verschoben, ${failed} fehlgeschlagen.`);
      } else {
        showToast(ids.length > 1
          ? `Konversation (${ids.length} Nachrichten) in den Papierkorb verschoben.`
          : 'In den Papierkorb verschoben.');
      }
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
      if (openId === id) { setOpenId(null); setOpenMail(null); setOpenThread(null); }
      const targetName = folders.find((f) => f.id === destinationId)?.displayName ?? 'Ordner';
      showToast(`Verschoben nach „${targetName}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Verschieben fehlgeschlagen.');
    }
  }

  // ---- Tour-Hooks (nur primäres Postfach) ----
  // Bei Threads beziehen sich Antworten/Weiterleiten auf die NEUESTE
  // Nachricht der Konversation, nicht auf die gerade ausgewählte.
  const replyTarget = openThread ? openThread[openThread.length - 1] : openMail;
  function openReply() {
    if (!replyTarget) return;
    setComposer({
      mode: 'reply',
      initial: {
        from: activeMailbox,
        to: replyTarget.from.address ? [replyTarget.from.address] : [],
        cc: [],
        subject: replyTarget.subject.startsWith('Re:') ? replyTarget.subject : `Re: ${replyTarget.subject}`,
        bodyHtml: '',
        messageId: replyTarget.id,
      },
    });
  }
  function openForward() {
    if (!replyTarget) return;
    // Original-Inhalt als Zitat-HTML — wird im Composer unter dem
    // eigenen Text eingefügt (abwählbar).
    const quoteHtml = `
      <br/><div style="border-left:3px solid #94A3B8;margin-top:12px;padding:8px 12px;color:#334155;">
        <p style="font-size:12px;color:#64748B;margin:0 0 8px 0;">
          ---------- Weitergeleitete Nachricht ----------<br/>
          Von: ${replyTarget.from.name ?? ''} &lt;${replyTarget.from.address ?? ''}&gt;<br/>
          Datum: ${formatMailDate(replyTarget.receivedDateTime)}<br/>
          Betreff: ${replyTarget.subject}
        </p>
        ${replyTarget.bodyContentType === 'html' ? replyTarget.bodyHtml : `<pre style="white-space:pre-wrap;font-family:inherit;">${replyTarget.bodyHtml}</pre>`}
      </div>`;
    setComposer({
      mode: 'forward',
      initial: {
        from: activeMailbox,
        to: [],
        cc: [],
        subject: replyTarget.subject.startsWith('Fwd:') ? replyTarget.subject : `Fwd: ${replyTarget.subject}`,
        bodyHtml: '',
        messageId: replyTarget.id,
        quoteHtml,
        originalAttachments: replyTarget.attachments,
        originalMailbox: activeMailbox,
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
    // Höhen-Korsett nur auf Desktop (lg): dort scrollen Liste/Detail in
    // eigenen Spalten. Auf Mobile normale Seiten-Höhe + Seiten-Scroll —
    // sonst quetschen sich die Panes in winzige Scroll-Container.
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[28rem] lg:overflow-hidden">
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
            initial: {
              // Aufgabe 3: Neue E-Mails standardmäßig aus mail_inbox_1
              // (info@). Reply/Forward bleiben am aktiven Postfach.
              from: mailboxes.find((m) => m.key === 'mail_inbox_1')?.address || activeMailbox,
              to: [], cc: [], subject: '', bodyHtml: '',
            },
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
        <div className="flex min-h-0 flex-1 flex-col lg:overflow-hidden">
          {pendingTour.mode === 'create' ? (
            <TourFromEmailPanel
              mail={openMail}
              mailbox={activeMailbox}
              onClose={() => setPendingTour(null)}
              onCreated={(label) => { setPendingTour(null); showToast(`Tour erstellt: ${label}`); }}
            />
          ) : pendingTour.mode === 'edit' ? (
            <TourEditFromEmailPanel
              mail={openMail}
              mailbox={activeMailbox}
              tourId={pendingTour.tourId}
              onClose={() => setPendingTour(null)}
              onSaved={() => { setPendingTour(null); showToast('Tour gespeichert.'); }}
            />
          ) : (
            <ZusaetzeFromEmailPanel
              mail={openMail}
              mailbox={activeMailbox}
              tourId={pendingTour.tourId}
              mode={pendingTour.mode === 'zusaetze-belege' ? 'zusaetze-belege' : 'zusaetze'}
              onClose={() => setPendingTour(null)}
            />
          )}
        </div>
      ) : (
        // Mobile (<lg): gestapelte Navigation — Ordner-Dropdown + Liste in
        // voller Breite/Höhe; geöffnete E-Mail ERSETZT die Liste (Vollbild)
        // mit „← Posteingang"-Zurück-Button.
        // Desktop (lg+): unverändert drei Spalten mit eigenem Scroll.
        <div className="min-h-0 flex-1 space-y-3 lg:grid lg:gap-4 lg:space-y-0 lg:overflow-hidden lg:grid-cols-[14rem_minmax(0,2fr)_minmax(0,3fr)]">
          {!openId && (
            <div className="lg:hidden">
              <FolderDropdown
                folders={folders}
                loading={foldersLoading}
                activeId={activeFolderId}
                onChoose={chooseFolder}
              />
            </div>
          )}
          <div className="hidden min-h-0 lg:grid lg:grid-rows-[minmax(0,1fr)]">
            <FolderSidebar
              folders={folders}
              loading={foldersLoading}
              activeId={activeFolderId}
              onChoose={chooseFolder}
            />
          </div>
          <div className={`${openId ? 'hidden lg:grid' : 'grid'} min-h-0 lg:grid-rows-[minmax(0,1fr)]`}>
          <ListPane
            threads={visibleThreads}
            loading={listLoading}
            error={listError}
            search={search}
            onSearch={(s) => { setSearch(s); setPage(1); }}
            openId={openId}
            onOpen={(id) => {
              setOpenId(id);
              // Mobile: die Detail-Ansicht ersetzt die Liste — nach oben
              // scrollen, damit die E-Mail am Kopf beginnt.
              if (window.innerWidth < 1024) window.scrollTo({ top: 0 });
            }}
            onFlag={handleToggleFlag}
            page={page}
            onPage={setPage}
            totalCount={showClassificationTabs ? undefined : totalCount}
            filteredCount={showClassificationTabs ? filteredList.length : undefined}
            hasNextPage={hasNextPage}
            classification={classification}
            onClassification={chooseClassification}
            focusedUnread={focusedUnread}
            otherUnread={otherUnread}
            showClassificationTabs={showClassificationTabs}
            ownAddresses={ownAddresses}
            onRefresh={refreshAll}
          />
          </div>
          <div className={`${openId ? 'grid' : 'hidden lg:grid'} min-h-0 gap-2 lg:grid-rows-[minmax(0,1fr)]`}>
          <button
            type="button"
            onClick={() => { setOpenId(null); window.scrollTo({ top: 0 }); }}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-maja-navy/15 bg-white px-3 py-1.5 text-sm font-medium text-maja-navy hover:bg-maja-light lg:hidden"
          >
            ← Posteingang
          </button>
          <DetailPane
            mailbox={activeMailbox}
            loading={openLoading}
            error={openError}
            mail={openMail}
            thread={openThread}
            ownAddresses={ownAddresses}
            isPrimary={isPrimaryMailbox}
            folders={folders}
            activeFolderId={activeFolderId}
            onReply={openReply}
            onForward={openForward}
            onCreateTour={() => setPendingTour({ mode: 'create' })}
            onOpenTour={() => setTourPicker('open')}
            onAddZusaetze={() => setTourPicker('zusaetze')}
            onAddZusaetzeBelege={() => setTourPicker('zusaetze-belege')}
            onDelete={(id) => requestDelete(id)}
            onMove={handleMove}
          />
          </div>
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
            setPage(1);
            void loadFirstPage();
          }}
        />
      )}
      {tourPicker && (
        <TourPickerDialog
          onClose={() => setTourPicker(null)}
          onPick={(tourId) => {
            const purpose = tourPicker;
            setTourPicker(null);
            if (purpose === 'open') setPendingTour({ mode: 'edit', tourId });
            else if (purpose === 'zusaetze') setPendingTour({ mode: 'zusaetze', tourId });
            else if (purpose === 'zusaetze-belege') setPendingTour({ mode: 'zusaetze-belege', tourId });
          }}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmDialog
          count={confirmDelete.ids.length}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete(confirmDelete.ids)}
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
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <h3 className="border-b border-maja-navy/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-maja-muted">
        Ordner
      </h3>
      {loading ? (
        <div className="p-3 text-xs text-maja-muted">Lade …</div>
      ) : (
        <ul className="flex-1 divide-y divide-maja-navy/5 overflow-y-auto overscroll-contain text-sm">
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

/** Mobile Ordner-Auswahl (<lg): Dropdown statt Sidebar-Spalte. */
function FolderDropdown({
  folders, loading, activeId, onChoose,
}: {
  folders: MailFolder[];
  loading: boolean;
  activeId: string;
  onChoose: (id: string) => void;
}) {
  const wellKnown = folders.filter((f) => !!f.wellKnown);
  const custom = folders
    .filter((f) => !f.wellKnown)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' }));
  // Selektierten Wert auf dieselben IDs normalisieren wie FolderRow
  // (well-known-ID bevorzugt, sonst Roh-ID).
  const value = [...wellKnown, ...custom]
    .find((f) => isFolderActive(activeId, f));
  return (
    <label className="block">
      <span className="sr-only">Ordner</span>
      <select
        className="input"
        disabled={loading}
        value={value ? (value.wellKnown ?? value.id) : activeId}
        onChange={(e) => onChoose(e.target.value)}
        aria-label="Ordner wählen"
      >
        {loading && <option value={activeId}>Ordner werden geladen …</option>}
        {wellKnown.map((f) => (
          <option key={f.id} value={f.wellKnown ?? f.id}>
            {f.displayName || '(unbenannt)'}
            {f.unreadItemCount > 0 ? ` (${f.unreadItemCount})` : ''}
          </option>
        ))}
        {custom.map((f) => (
          <option key={f.id} value={f.id}>
            {f.displayName || '(unbenannt)'}
            {f.unreadItemCount > 0 ? ` (${f.unreadItemCount})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
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
  /** Konversations-Threads (je innen chronologisch älteste→neueste). */
  threads: MailListItem[][];
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  openId: string | null;
  onOpen: (id: string) => void;
  onFlag: (m: MailListItem) => void;
  page: number;
  onPage: (n: number) => void;
  /** Server-Total (rohe Mailbox-Größe) — wird angezeigt, wenn keine
   *  clientseitige Klassifizierungs-Filterung aktiv ist. */
  totalCount?: number;
  /** Anzahl Einträge in der gefilterten Liste (über alle bereits
   *  geladenen API-Seiten). Wird in der Pagination-Zeile angezeigt. */
  filteredCount?: number;
  /** True, wenn entweder noch gefilterte Seiten vor uns liegen oder die
   *  API noch weitere Seiten nachladen kann. */
  hasNextPage: boolean;
  classification: 'focused' | 'other';
  onClassification: (c: 'focused' | 'other') => void;
  focusedUnread: number;
  otherUnread: number;
  showClassificationTabs: boolean;
  /** Eigene Postfach-Adressen (lowercase) — für „Gesendet"-Badges. */
  ownAddresses: string[];
  /** Aufgabe 1: lädt Liste + Ordner-Counts neu. */
  onRefresh: () => void;
}

function ListPane({
  threads, loading, error, search, onSearch, openId, onOpen, onFlag, page, onPage, totalCount,
  filteredCount, hasNextPage,
  classification, onClassification, focusedUnread, otherUnread, showClassificationTabs,
  ownAddresses, onRefresh,
}: ListPaneProps) {
  // Aufgeklappte Threads (per threadKey). Default: alle eingeklappt.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function isOwn(m: MailListItem): boolean {
    const addr = m.from.address?.trim().toLowerCase();
    return !!addr && ownAddresses.includes(addr);
  }
  return (
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-maja-navy/10 p-3">
        <input
          className="input"
          type="search"
          placeholder="Suche: Betreff oder Absender …"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 rounded-lg border border-maja-navy/20 bg-white p-2.5 text-maja-navy transition hover:bg-maja-light disabled:opacity-50"
          title="E-Mails neu laden"
          aria-label="E-Mails neu laden"
        >
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {showClassificationTabs && (
        <div className="flex border-b border-maja-navy/10 px-3">
          <ClassificationTab
            label="Relevant"
            active={classification === 'focused'}
            unread={focusedUnread}
            onClick={() => onClassification('focused')}
          />
          <ClassificationTab
            label="Sonstige"
            active={classification === 'other'}
            unread={otherUnread}
            onClick={() => onClassification('other')}
          />
        </div>
      )}
      {error && (
        <div role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <div className="p-4"><Spinner label="E-Mails werden geladen …" /></div>
      ) : threads.length === 0 ? (
        <p className="p-6 text-center text-sm text-maja-muted">Keine E-Mails gefunden.</p>
      ) : (
        <ul className="flex-1 divide-y divide-maja-navy/5 overflow-y-auto overscroll-contain">
          {threads.map((thread) => {
            const key = threadKey(thread);
            const newest = thread[thread.length - 1];
            const isThread = thread.length > 1;
            const isExpanded = expanded.has(key);
            const unreadCount = thread.filter((m) => !m.isRead).length;
            const threadActive = thread.some((m) => m.id === openId);
            return (
              <li key={key} className="relative">
                {/* Hauptzeile: neueste Mail des Threads */}
                <button
                  type="button"
                  onClick={() => onOpen(newest.id)}
                  className={`block w-full border-l-4 px-4 py-3 pl-9 text-left transition ${
                    threadActive && !isExpanded
                      ? 'border-maja-accent bg-maja-light dark:bg-slate-700'
                      : 'border-transparent hover:bg-maja-light/40 dark:hover:bg-slate-700/50'
                  } ${unreadCount > 0 ? 'bg-blue-50/30' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`flex min-w-0 items-baseline gap-1.5 truncate text-sm ${unreadCount > 0 ? 'font-semibold text-maja-navy' : 'text-maja-ink'}`}>
                      <span className="truncate">{newest.from.name || newest.from.address || '—'}</span>
                      {isThread && (
                        <span className="shrink-0 text-xs font-semibold text-maja-muted">({thread.length})</span>
                      )}
                      {isThread && unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-maja-accent/20 px-1.5 text-[10px] font-semibold text-maja-accent">
                          {unreadCount} ungelesen
                        </span>
                      )}
                      {isOwn(newest) && (
                        <span className="shrink-0 rounded bg-maja-navy/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
                          Gesendet
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-maja-muted">
                      {formatMailDate(newest.receivedDateTime)}
                    </span>
                  </div>
                  <div className={`mt-0.5 truncate text-sm ${unreadCount > 0 ? 'font-semibold text-maja-ink' : 'text-maja-ink'}`}>
                    {newest.subject || '(kein Betreff)'}
                    {newest.hasAttachments && <PaperclipIcon className="ml-1 inline h-3 w-3 text-maja-muted" />}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-maja-muted">
                    {newest.bodyPreview}
                  </div>
                </button>
                {/* Drei-Status-Markierung: Klick schaltet weiter
                    (offen → erledigt → keine). */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onFlag(newest); }}
                  className="absolute left-2 top-3 rounded p-0.5 text-maja-muted hover:bg-maja-light"
                  aria-label={flagActionLabel(newest.flagStatus)}
                  title={flagActionLabel(newest.flagStatus)}
                >
                  <FlagStatusIcon className="h-4 w-4" status={newest.flagStatus} />
                </button>
                {/* Chevron zum Auf-/Zuklappen */}
                {isThread && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
                    className="absolute right-2 bottom-2 rounded p-1 text-maja-muted hover:bg-maja-light hover:text-maja-navy"
                    aria-label={isExpanded ? 'Konversation einklappen' : 'Konversation aufklappen'}
                    aria-expanded={isExpanded}
                  >
                    <ChevronIcon className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                )}
                {/* Aufgeklappter Thread: alle Mails, älteste oben */}
                {isThread && isExpanded && (
                  <ul className="border-t border-maja-navy/5 bg-maja-light/20">
                    {thread.map((m) => {
                      const active = m.id === openId;
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => onOpen(m.id)}
                            className={`block w-full border-l-2 py-2 pl-8 pr-4 text-left transition ${
                              active
                                ? 'border-maja-accent bg-maja-light dark:bg-slate-700'
                                : 'border-transparent hover:bg-maja-light/40 dark:hover:bg-slate-700/50'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={`flex min-w-0 items-baseline gap-1.5 truncate text-xs ${!m.isRead ? 'font-semibold text-maja-navy' : 'text-maja-ink'}`}>
                                <span className="truncate">{m.from.name || m.from.address || '—'}</span>
                                {isOwn(m) && (
                                  <span className="shrink-0 rounded bg-maja-navy/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
                                    Gesendet
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-[11px] text-maja-muted">
                                {formatMailDate(m.receivedDateTime)}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-maja-muted">
                              {m.bodyPreview || m.subject}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-maja-navy/10 p-2 text-xs text-maja-muted">
        <span>
          {filteredCount != null
            ? `Seite ${page} — ${filteredCount} E-Mail${filteredCount === 1 ? '' : 's'}`
            : totalCount != null
              ? `${totalCount} E-Mails`
              : `Seite ${page}`}
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
            disabled={loading || !hasNextPage}
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
  /** Alle Nachrichten der Konversation (chronologisch, älteste zuerst).
   *  null = Einzel-Mail ohne Thread. */
  thread: MailDetail[] | null;
  /** Eigene Postfach-Adressen (lowercase) — eigene Nachrichten werden
   *  im Thread anders dargestellt. */
  ownAddresses: string[];
  isPrimary: boolean;
  folders: MailFolder[];
  activeFolderId: string;
  onReply: () => void;
  onForward: () => void;
  onCreateTour: () => void;
  onOpenTour: () => void;
  onAddZusaetze: () => void;
  onAddZusaetzeBelege: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, destinationId: string) => void;
}

function DetailPane({
  mailbox, loading, error, mail, thread, ownAddresses, isPrimary, folders, activeFolderId,
  onReply, onForward, onCreateTour, onOpenTour, onAddZusaetze, onAddZusaetzeBelege,
  onDelete, onMove,
}: DetailPaneProps) {
  if (loading) return <div className="card flex min-h-0 overflow-y-auto overscroll-contain p-6"><Spinner label="E-Mail wird geladen …" /></div>;
  if (error) {
    return <div role="alert" className="card min-h-0 overflow-y-auto overscroll-contain p-4 text-sm text-red-700">{error}</div>;
  }
  if (!mail) {
    return (
      <div className="card flex min-h-0 items-center justify-center overflow-y-auto overscroll-contain p-12 text-sm text-maja-muted">
        Wähle links eine E-Mail aus.
      </div>
    );
  }
  const isOwn = (m: MailDetail) => {
    const addr = m.from.address?.trim().toLowerCase();
    return !!addr && ownAddresses.includes(addr);
  };
  return (
    <div className="card flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <EmailMessageHeader mail={thread ? thread[thread.length - 1] : mail} />
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
          {isPrimary ? (
            <>
              <button type="button" className="btn-secondary text-sm" onClick={onOpenTour}>
                Tour öffnen
              </button>
              <button type="button" className="btn-primary text-sm" onClick={onCreateTour}>
                Tour erstellen
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary text-sm" onClick={onAddZusaetze}>
                Zusätze hinzufügen
              </button>
              <button type="button" className="btn-primary text-sm" onClick={onAddZusaetzeBelege}>
                Zusätze + Belege
              </button>
            </>
          )}
        </div>
      </div>
      {thread ? (
        <div className="space-y-6">
          {thread.map((m, idx) => {
            const selected = m.id === mail.id;
            const own = isOwn(m);
            return (
              <div
                key={m.id}
                className={`rounded-lg border p-4 ${
                  selected
                    ? 'border-maja-accent ring-1 ring-maja-accent/40'
                    : 'border-maja-navy/10'
                } ${own ? 'bg-maja-light/40' : ''}`}
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-maja-navy/10 pb-2">
                  <span className="flex min-w-0 items-baseline gap-2 text-sm font-medium text-maja-ink">
                    <span className="truncate">
                      {m.from.name || m.from.address || '—'}
                    </span>
                    {own && (
                      <span className="shrink-0 rounded bg-maja-navy/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
                        Gesendet
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-normal text-maja-muted">
                      Nachricht {idx + 1} von {thread.length}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-maja-muted">
                    {formatMailDate(m.receivedDateTime)}
                  </span>
                </div>
                <EmailMessageView mail={m} mailbox={mailbox} />
              </div>
            );
          })}
        </div>
      ) : (
        <EmailMessageView mail={mail} mailbox={mailbox} />
      )}
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
  count, onConfirm, onCancel,
}: { count: number; onConfirm: () => void; onCancel: () => void }) {
  const isThread = count > 1;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">
          {isThread
            ? `Gesamte Konversation (${count} Nachrichten) in den Papierkorb verschieben?`
            : 'E-Mail in den Papierkorb verschieben?'}
        </h3>
        <p className="mt-2 text-sm text-maja-muted">
          {isThread
            ? `Alle ${count} Nachrichten dieser Konversation im aktuellen Ordner werden in den „Papierkorb" verschoben und können von dort wiederhergestellt werden.`
            : 'Die Nachricht wird in den Ordner „Papierkorb" verschoben und kann von dort wiederhergestellt werden.'}
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

function ClassificationTab({
  label, active, unread, onClick,
}: {
  label: string;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? 'border-maja-navy text-maja-navy'
          : 'border-transparent text-maja-muted hover:text-maja-navy'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
      {unread > 0 && (
        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${
          active ? 'bg-maja-navy text-white' : 'bg-maja-accent/20 text-maja-accent'
        }`}>
          {unread}
        </span>
      )}
    </button>
  );
}

function RefreshCwIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
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

/** Tooltip/aria-Text: was passiert beim NÄCHSTEN Klick. */
function flagActionLabel(status: FlagStatus): string {
  if (status === 'notFlagged') return 'Markieren (zur Nachverfolgung)';
  if (status === 'flagged') return 'Als erledigt markieren';
  return 'Markierung entfernen';
}

/**
 * Drei-Status-Markierung wie in Outlook:
 *   notFlagged → graues Outline-Fähnchen
 *   flagged    → gefülltes oranges Fähnchen
 *   complete   → grünes Häkchen
 */
function FlagStatusIcon({ className, status }: { className?: string; status: FlagStatus }) {
  if (status === 'complete') {
    return (
      <svg viewBox="0 0 20 20" fill="none" stroke="#16a34a"
           strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
           className={className} aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    );
  }
  const filled = status === 'flagged';
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
