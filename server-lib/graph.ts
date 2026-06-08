// Microsoft Graph helper. Läuft im Vercel-Server-Kontext.
// Nutzt Client-Credentials-Flow → braucht AZURE_TENANT_ID, AZURE_CLIENT_ID,
// AZURE_CLIENT_SECRET aus den Vercel-Env-Variablen.
// Alle Datei-Operationen laufen gegen das Drive von ONEDRIVE_USER_EMAIL.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

interface CachedToken { token: string; expiresAt: number }
let cached: CachedToken | null = null;

function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? '';
}

export async function getGraphToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const tenant = env('AZURE_TENANT_ID');
  const clientId = env('AZURE_CLIENT_ID');
  const clientSecret = env('AZURE_CLIENT_SECRET');

  const resp = await fetch(`${LOGIN}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!resp.ok) {
    throw new Error(`Token-Request fehlgeschlagen: ${resp.status} ${await resp.text()}`);
  }
  const j = (await resp.json()) as { access_token: string; expires_in: number };
  cached = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
  };
  return cached.token;
}

function userRoot(): string {
  const upn = env('ONEDRIVE_USER_EMAIL');
  return `${GRAPH}/users/${encodeURIComponent(upn)}/drive`;
}

/** Encodiert einen Pfad für Graph-URLs. Slashes bleiben, Sonderzeichen werden escaped. */
function encodePath(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

/**
 * Legt eine Upload-Session für einen großen Datei-Upload an und gibt
 * die signierte uploadUrl zurück. Der Browser kann dann mit PUTs auf
 * diese URL hochladen — die Datei umgeht das 4.5 MB Vercel-Function-
 * Payload-Limit komplett.
 */
export async function createUploadSession(path: string): Promise<{ uploadUrl: string }> {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureFolderPath(path.slice(0, lastSlash));
  }
  const sessionUrl = `${userRoot()}/root:/${encodePath(path)}:/createUploadSession`;
  const resp = await graphFetch('POST', sessionUrl, {
    item: { '@microsoft.graph.conflictBehavior': 'replace', name: path.split('/').pop() },
  });
  if (!resp.ok) {
    throw new Error(`createUploadSession fehlgeschlagen: ${resp.status} ${await resp.text()}`);
  }
  const json = (await resp.json()) as { uploadUrl: string };
  if (!json.uploadUrl) throw new Error('Graph lieferte keine uploadUrl');
  return { uploadUrl: json.uploadUrl };
}

async function graphFetch(
  method: string, url: string, body?: unknown, headers: Record<string, string> = {},
): Promise<Response> {
  const token = await getGraphToken();
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  };
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    init.body = body as BodyInit;
  } else if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return await fetch(url, init);
}

interface DriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
}

/**
 * Stellt sicher, dass ein Ordner-Pfad existiert. Erzeugt fehlende Segmente
 * bottom-up. Konflikt (Ordner existiert bereits) wird als „ok" behandelt.
 */
export async function ensureFolderPath(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    const parentPath = current;
    current = current ? `${current}/${part}` : part;
    const childrenUrl = parentPath
      ? `${userRoot()}/root:/${encodePath(parentPath)}:/children`
      : `${userRoot()}/root/children`;
    const resp = await graphFetch('POST', childrenUrl, {
      name: part,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });
    if (resp.status === 201 || resp.status === 200) continue;
    if (resp.status === 409) continue; // existiert bereits
    const text = await resp.text();
    throw new Error(`ensureFolder ${current} failed: ${resp.status} ${text}`);
  }
}

/**
 * Lädt eine Datei nach OneDrive hoch. Erzeugt fehlende Ordner automatisch.
 * Bei Dateien > 4 MB wird eine Upload-Session genutzt.
 */
export async function uploadFile(
  path: string, bytes: Uint8Array, contentType: string,
): Promise<DriveItem> {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureFolderPath(path.slice(0, lastSlash));
  }
  if (bytes.byteLength <= 4 * 1024 * 1024) {
    return await uploadSmall(path, bytes, contentType);
  }
  return await uploadLarge(path, bytes, contentType);
}

async function uploadSmall(
  path: string, bytes: Uint8Array, contentType: string,
): Promise<DriveItem> {
  const url = `${userRoot()}/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=replace`;
  const resp = await graphFetch('PUT', url, bytes, { 'Content-Type': contentType });
  if (!resp.ok) throw new Error(`Upload ${path} fehlgeschlagen: ${resp.status} ${await resp.text()}`);
  return (await resp.json()) as DriveItem;
}

async function uploadLarge(
  path: string, bytes: Uint8Array, contentType: string,
): Promise<DriveItem> {
  const sessionUrl = `${userRoot()}/root:/${encodePath(path)}:/createUploadSession`;
  const sessResp = await graphFetch('POST', sessionUrl, {
    item: { '@microsoft.graph.conflictBehavior': 'replace', name: path.split('/').pop() },
  });
  if (!sessResp.ok) throw new Error(`UploadSession fehlgeschlagen: ${await sessResp.text()}`);
  const { uploadUrl } = (await sessResp.json()) as { uploadUrl: string };
  const chunkSize = 5 * 1024 * 1024;
  let offset = 0;
  let last: DriveItem | null = null;
  while (offset < bytes.byteLength) {
    const end = Math.min(offset + chunkSize, bytes.byteLength);
    const slice = bytes.subarray(offset, end);
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(slice.byteLength),
        'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}`,
      },
      body: slice as BodyInit,
    });
    if (!r.ok && r.status !== 202) throw new Error(`Chunk-Upload fehlgeschlagen: ${await r.text()}`);
    if (r.status === 200 || r.status === 201) last = (await r.json()) as DriveItem;
    offset = end;
  }
  if (!last) throw new Error('Upload abgeschlossen, aber kein DriveItem zurückgegeben');
  return last;
}

/**
 * Löscht eine Datei in OneDrive. 404 wird als „bereits weg" toleriert,
 * weil der Aufrufer nach erfolgreichem Submit ggf. erneut aufräumt.
 */
export async function deleteFile(path: string): Promise<void> {
  const url = `${userRoot()}/root:/${encodePath(path)}`;
  const resp = await graphFetch('DELETE', url);
  if (resp.status === 204 || resp.status === 200 || resp.status === 404) return;
  throw new Error(`Delete ${path}: ${resp.status} ${await resp.text()}`);
}

/** Lädt eine Datei aus OneDrive runter und gibt die Bytes zurück. */
export async function downloadFile(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = `${userRoot()}/root:/${encodePath(path)}:/content`;
  const resp = await graphFetch('GET', url);
  if (!resp.ok) throw new Error(`Download ${path}: ${resp.status} ${await resp.text()}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return { bytes: buf, contentType: resp.headers.get('content-type') ?? 'application/octet-stream' };
}

/** Listet die Items eines Ordners. */
export async function listChildren(folderPath: string): Promise<DriveItem[]> {
  const url = folderPath
    ? `${userRoot()}/root:/${encodePath(folderPath)}:/children`
    : `${userRoot()}/root/children`;
  const resp = await graphFetch('GET', url);
  if (!resp.ok) throw new Error(`List ${folderPath}: ${resp.status} ${await resp.text()}`);
  const j = (await resp.json()) as { value: DriveItem[] };
  return j.value ?? [];
}

/** Liefert eine kurzlebige WebUrl/DownloadUrl für eine Datei. */
export async function getItemMeta(path: string): Promise<DriveItem | null> {
  const url = `${userRoot()}/root:/${encodePath(path)}`;
  const resp = await graphFetch('GET', url);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Meta ${path}: ${resp.status}`);
  return (await resp.json()) as DriveItem;
}

interface MailRecipient { emailAddress: { address: string } }
interface MailAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;  // base64
}

/** Versendet eine Email — Default-Absender ist ONEDRIVE_USER_EMAIL,
 *  per `from` lässt sich pro Aufruf ein anderes Postfach wählen
 *  (siehe Aufgabe 3: Rechnungs-Mails über info@ statt protokollierung@). */
export async function sendMail(args: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain-Text-Inhalt. Wird verwendet, wenn bodyHtml nicht gesetzt ist. */
  bodyText: string;
  /** Optional: HTML-Body. Hat Vorrang vor bodyText. */
  bodyHtml?: string;
  /** Absende-Postfach (UPN). Default: ONEDRIVE_USER_EMAIL aus Env. */
  from?: string;
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
}): Promise<void> {
  const upn = (args.from && args.from.trim()) ? args.from.trim() : env('ONEDRIVE_USER_EMAIL');
  const url = `${GRAPH}/users/${encodeURIComponent(upn)}/sendMail`;
  const recipients = (xs: string[]): MailRecipient[] =>
    xs.map((a) => ({ emailAddress: { address: a } }));

  // Self-Mail-Workaround: Wenn der Sender (= Mailbox-User) selbst in
  // toRecipients steht, lehnen viele Outlook-Setups die Zustellung in
  // die EIGENE Inbox ab (Mail landet nur im Sent-Folder). Wir verschieben
  // den Sender-Eintrag in diesem Fall in BCC, damit die Mail garantiert
  // im Postfach des Empfängers ankommt. Mindestens ein "echter" anderer
  // Empfänger MUSS in to bleiben — wenn der Sender alleine to wäre,
  // setzen wir einen Dummy-To.
  const upnNorm = upn.trim().toLowerCase();
  const toClean = args.to.filter((a) => a.trim().toLowerCase() !== upnNorm);
  const ccClean = (args.cc ?? []).filter((a) => a.trim().toLowerCase() !== upnNorm);
  const bccExtra = args.to.some((a) => a.trim().toLowerCase() === upnNorm)
                || (args.cc ?? []).some((a) => a.trim().toLowerCase() === upnNorm)
    ? [upn] : [];
  const finalTo = toClean.length > 0
    ? toClean
    : (bccExtra.length > 0 ? [upn] : args.to);
  const finalCc = ccClean.length > 0 ? ccClean : undefined;
  const finalBcc = [...(args.bcc ?? []), ...bccExtra];

  const att: MailAttachment[] = (args.attachments ?? []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: bytesToBase64(a.bytes),
  }));

  const body = {
    message: {
      subject: args.subject,
      body: args.bodyHtml
        ? { contentType: 'HTML', content: args.bodyHtml }
        : { contentType: 'Text', content: args.bodyText },
      from: { emailAddress: { address: upn } },
      toRecipients: recipients(finalTo),
      ccRecipients: finalCc ? recipients(finalCc) : undefined,
      bccRecipients: finalBcc.length > 0 ? recipients(finalBcc) : undefined,
      attachments: att.length > 0 ? att : undefined,
    },
    saveToSentItems: true,
  };

  console.info(
    `[graph.sendMail] from=${upn} to=${finalTo.join(',')} cc=${(finalCc ?? []).join(',')} bcc=${finalBcc.join(',')} attachments=${att.length}`,
  );

  const resp = await graphFetch('POST', url, body);
  if (!resp.ok) throw new Error(`sendMail: ${resp.status} ${await resp.text()}`);
}

// ============================================================
// Mail-Read / Reply / Forward / Attachment-Helpers für Posteingang
// ------------------------------------------------------------
// Die Funktionen sprechen mit Graph als der Server-App (client_
// credentials). Die Azure-App-Registration braucht für Lesen
// `Mail.Read` (Application-Permission) und für Antworten /
// Weiterleiten `Mail.Send`/`Mail.ReadWrite` (Application-Permission).
// Wenn die Berechtigungen fehlen, schlägt der Call mit 403/404 fehl —
// die Endpunkte reichen den Fehler durch, damit die UI eine
// klare Meldung anzeigen kann.
// ============================================================

export interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  totalItemCount: number;
  unreadItemCount: number;
  /** Well-known-Folder-Name in lowercase, wenn id ein well-known-Name
   *  ist (inbox, sentitems, drafts, deleteditems). Sonst null. */
  wellKnown: string | null;
}

/** Listet die Mail-Ordner eines Postfachs (inkl. WellKnown-Mapping). */
export async function listFolders(mailbox: string): Promise<MailFolder[]> {
  // Graph default $top ist 10 — reicht für Stammkunden meistens nicht
  // (Inbox-Subfolder), also explizit $top=200 setzen.
  const url = `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders?$top=200&$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount`;
  const resp = await graphFetch('GET', url);
  if (!resp.ok) throw new Error(`listFolders: ${resp.status} ${await resp.text()}`);
  const j = await resp.json() as { value?: Array<Record<string, unknown>> };
  const out: MailFolder[] = (j.value ?? []).map((f) => ({
    id: String(f.id),
    displayName: String(f.displayName ?? ''),
    parentFolderId: typeof f.parentFolderId === 'string' ? f.parentFolderId : null,
    totalItemCount: Number(f.totalItemCount ?? 0),
    unreadItemCount: Number(f.unreadItemCount ?? 0),
    wellKnown: null,
  }));
  // Well-Known-Folder zusätzlich abholen — Graph akzeptiert die
  // Namen als Folder-ID für POST /move u.ä. Wir liefern sie als
  // separate Liste, damit das Frontend stable IDs für "inbox" etc.
  // bekommt, ohne sie aus displayName raten zu müssen.
  const wellKnownNames = ['inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'archive'];
  const wellKnownLabels: Record<string, string> = {
    inbox: 'Posteingang',
    sentitems: 'Gesendet',
    drafts: 'Entwürfe',
    deleteditems: 'Papierkorb',
    junkemail: 'Junk',
    archive: 'Archiv',
  };
  const wellKnownFolders: MailFolder[] = [];
  for (const name of wellKnownNames) {
    try {
      const wkUrl = `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/${name}?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount`;
      const r = await graphFetch('GET', wkUrl);
      if (!r.ok) continue;
      const f = await r.json() as Record<string, unknown>;
      wellKnownFolders.push({
        id: String(f.id),
        displayName: wellKnownLabels[name] ?? String(f.displayName ?? name),
        parentFolderId: typeof f.parentFolderId === 'string' ? f.parentFolderId : null,
        totalItemCount: Number(f.totalItemCount ?? 0),
        unreadItemCount: Number(f.unreadItemCount ?? 0),
        wellKnown: name,
      });
    } catch { /* einzelner WellKnown-Folder fehlt → ignorieren */ }
  }
  // Wenn ein well-known Folder denselben displayName wie ein Rohlisten-
  // Folder hat (üblich bei "Posteingang"), behalten wir den well-known —
  // sonst entsprechende Roh-Einträge anhängen.
  const wkIds = new Set(wellKnownFolders.map((f) => f.id));
  const rest = out.filter((f) => !wkIds.has(f.id));
  return [...wellKnownFolders, ...rest];
}

/** Verschiebt eine Nachricht in einen anderen Ordner. */
export async function moveMessage(args: {
  mailbox: string; messageId: string; destinationId: string;
}): Promise<void> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}/move`;
  const resp = await graphFetch('POST', url, { destinationId: args.destinationId });
  if (!resp.ok) throw new Error(`moveMessage: ${resp.status} ${await resp.text()}`);
}

/** Setzt Flag/Read-Status auf einer Nachricht. */
export async function patchMessage(args: {
  mailbox: string;
  messageId: string;
  flagged?: boolean;
  isRead?: boolean;
}): Promise<void> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}`;
  const body: Record<string, unknown> = {};
  if (typeof args.flagged === 'boolean') {
    body.flag = { flagStatus: args.flagged ? 'flagged' : 'notFlagged' };
  }
  if (typeof args.isRead === 'boolean') body.isRead = args.isRead;
  const resp = await graphFetch('PATCH', url, body);
  if (!resp.ok) throw new Error(`patchMessage: ${resp.status} ${await resp.text()}`);
}

export interface MailListItem {
  id: string;
  subject: string;
  from: { name: string | null; address: string | null };
  receivedDateTime: string;
  bodyPreview: string;
  hasAttachments: boolean;
  isRead: boolean;
  /** Graph-Flag-Status: "flagged" | "notFlagged" | "complete". */
  flagged: boolean;
  /** Focused Inbox: 'focused' | 'other' | null (unbekannt / nicht
   *  unterstützt). Wird im Frontend für die Relevant/Sonstige-Tabs
   *  ausgewertet — clientseitiges Filtern statt $filter, weil
   *  inferenceClassification + $orderby = InefficientFilter. */
  inferenceClassification: 'focused' | 'other' | null;
}

export interface MailDetail extends MailListItem {
  to: Array<{ name: string | null; address: string | null }>;
  cc: Array<{ name: string | null; address: string | null }>;
  bodyHtml: string;
  bodyContentType: 'html' | 'text';
  attachments: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
  }>;
}

interface RawRecipient { name?: string; address?: string }
interface RawGraphRecipient { emailAddress?: RawRecipient }
interface RawAttachment {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
}
interface RawMessage {
  id: string;
  subject?: string;
  from?: RawGraphRecipient;
  toRecipients?: RawGraphRecipient[];
  ccRecipients?: RawGraphRecipient[];
  receivedDateTime?: string;
  bodyPreview?: string;
  hasAttachments?: boolean;
  isRead?: boolean;
  body?: { contentType?: string; content?: string };
  flag?: { flagStatus?: string };
  inferenceClassification?: 'focused' | 'other' | string;
}

function recipient(r: RawGraphRecipient | undefined): { name: string | null; address: string | null } {
  return {
    name:    r?.emailAddress?.name    ?? null,
    address: r?.emailAddress?.address ?? null,
  };
}
function recipientList(rs: RawGraphRecipient[] | undefined) {
  return (rs ?? []).map((r) => recipient(r));
}

/** Listet Nachrichten eines Postfachs (Posteingang-Folder).
 *
 *  `inferenceClassification` (Focused Inbox: focused/other) wird IMMER
 *  mitgeladen, aber nie als $filter benutzt — Graph wirft sonst
 *  `InefficientFilter` in Kombination mit $orderby, und $filter ist
 *  zusätzlich nicht mit $search kompatibel. Die Tabs „Relevant"/
 *  „Sonstige" filtern darum clientseitig. */
export async function listMessages(args: {
  mailbox: string;
  folder?: string;
  page?: number;
  pageSize?: number;
  search?: string | null;
}): Promise<{ value: MailListItem[]; totalCount?: number }> {
  const folder = args.folder ?? 'inbox';
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20));
  const skip = (page - 1) * pageSize;
  const params = new URLSearchParams();
  params.set('$top', String(pageSize));
  params.set('$skip', String(skip));
  params.set('$orderby', 'receivedDateTime desc');
  params.set('$select', 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead,flag,inferenceClassification');
  params.set('$count', 'true');

  // Graph: $search + $filter / $orderby ist nicht kompatibel. Bei einer
  // aktiven Suche fallen $orderby und alle $filter weg; die Sortierung
  // erfolgt clientseitig.
  if (args.search) {
    params.delete('$orderby');
    params.set('$search', `"${args.search.replace(/"/g, '\\"')}"`);
  }
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`;
  const resp = await graphFetch('GET', url, undefined, { ConsistencyLevel: 'eventual' });
  if (!resp.ok) {
    throw new Error(`listMessages: ${resp.status} ${await resp.text()}`);
  }
  const j = await resp.json() as { value?: RawMessage[]; '@odata.count'?: number };
  const value = (j.value ?? []).map((m): MailListItem => ({
    id: m.id,
    subject: m.subject ?? '',
    from: recipient(m.from),
    receivedDateTime: m.receivedDateTime ?? '',
    bodyPreview: m.bodyPreview ?? '',
    hasAttachments: !!m.hasAttachments,
    isRead: !!m.isRead,
    flagged: m.flag?.flagStatus === 'flagged',
    inferenceClassification: m.inferenceClassification === 'focused' ? 'focused'
      : m.inferenceClassification === 'other' ? 'other'
      : null,
  }));
  // Bei aktiver Suche fällt Graph-$orderby weg → clientseitig
  // nach receivedDateTime DESC sortieren, damit die Liste konsistent
  // bleibt.
  if (args.search) {
    value.sort((a, b) =>
      (b.receivedDateTime || '').localeCompare(a.receivedDateTime || ''),
    );
  }
  return { value, totalCount: j['@odata.count'] };
}

/** Holt eine einzelne Nachricht inkl. Body + Anhangs-Metadaten. */
export async function getMessage(args: {
  mailbox: string;
  messageId: string;
}): Promise<MailDetail> {
  const select = '$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,body,flag,inferenceClassification';
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}?${select}`;
  const resp = await graphFetch('GET', url, undefined, { Prefer: 'outlook.body-content-type="html"' });
  if (!resp.ok) {
    throw new Error(`getMessage: ${resp.status} ${await resp.text()}`);
  }
  const m = await resp.json() as RawMessage;
  let attachments: MailDetail['attachments'] = [];
  if (m.hasAttachments) {
    const aUrl = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}/attachments?$select=id,name,contentType,size`;
    const aResp = await graphFetch('GET', aUrl);
    if (aResp.ok) {
      const aJson = await aResp.json() as { value?: RawAttachment[] };
      attachments = (aJson.value ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? 0,
      }));
    }
  }
  const contentType = (m.body?.contentType ?? 'html').toLowerCase() === 'text'
    ? 'text' as const : 'html' as const;
  return {
    id: m.id,
    subject: m.subject ?? '',
    from: recipient(m.from),
    to: recipientList(m.toRecipients),
    cc: recipientList(m.ccRecipients),
    receivedDateTime: m.receivedDateTime ?? '',
    bodyPreview: m.bodyPreview ?? '',
    hasAttachments: !!m.hasAttachments,
    isRead: !!m.isRead,
    flagged: m.flag?.flagStatus === 'flagged',
    inferenceClassification: m.inferenceClassification === 'focused' ? 'focused'
      : m.inferenceClassification === 'other' ? 'other'
      : null,
    bodyHtml: m.body?.content ?? '',
    bodyContentType: contentType,
    attachments,
  };
}

/** Lädt einen einzelnen Anhang als Binär (FileAttachment, decoded). */
export async function getAttachmentBytes(args: {
  mailbox: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ name: string; contentType: string; bytes: Uint8Array }> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}/attachments/${encodeURIComponent(args.attachmentId)}`;
  const resp = await graphFetch('GET', url);
  if (!resp.ok) {
    throw new Error(`getAttachment: ${resp.status} ${await resp.text()}`);
  }
  const a = await resp.json() as {
    '@odata.type'?: string;
    name: string;
    contentType?: string;
    contentBytes?: string;
  };
  if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || !a.contentBytes) {
    throw new Error('Anhang nicht unterstützt (kein FileAttachment).');
  }
  const buf = typeof Buffer !== 'undefined'
    ? new Uint8Array(Buffer.from(a.contentBytes, 'base64'))
    : Uint8Array.from(atob(a.contentBytes), (c) => c.charCodeAt(0));
  return {
    name: a.name,
    contentType: a.contentType ?? 'application/octet-stream',
    bytes: buf,
  };
}

/** Sendet eine neue Mail vom angegebenen Postfach aus. */
export async function sendMailFrom(args: {
  mailbox: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
}): Promise<void> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/sendMail`;
  const recipients = (xs: string[]): MailRecipient[] =>
    xs.map((a) => ({ emailAddress: { address: a } }));
  const att: MailAttachment[] = (args.attachments ?? []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: bytesToBase64(a.bytes),
  }));
  const payload = {
    message: {
      subject: args.subject,
      body: { contentType: 'HTML', content: args.bodyHtml },
      toRecipients: recipients(args.to),
      ccRecipients: args.cc && args.cc.length > 0 ? recipients(args.cc) : undefined,
      attachments: att.length > 0 ? att : undefined,
    },
    saveToSentItems: true,
  };
  const resp = await graphFetch('POST', url, payload);
  if (!resp.ok) throw new Error(`sendMailFrom: ${resp.status} ${await resp.text()}`);
}

/** Antwortet auf eine Nachricht (an den Original-Absender). */
export async function replyMail(args: {
  mailbox: string;
  messageId: string;
  bodyHtml: string;
  to?: string[];
  cc?: string[];
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
}): Promise<void> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}/reply`;
  const recipients = (xs: string[]): MailRecipient[] =>
    xs.map((a) => ({ emailAddress: { address: a } }));
  const att: MailAttachment[] = (args.attachments ?? []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: bytesToBase64(a.bytes),
  }));
  const payload: Record<string, unknown> = {
    message: {
      body: { contentType: 'HTML', content: args.bodyHtml },
      toRecipients: args.to && args.to.length > 0 ? recipients(args.to) : undefined,
      ccRecipients: args.cc && args.cc.length > 0 ? recipients(args.cc) : undefined,
      attachments: att.length > 0 ? att : undefined,
    },
  };
  const resp = await graphFetch('POST', url, payload);
  if (!resp.ok) throw new Error(`replyMail: ${resp.status} ${await resp.text()}`);
}

/** Leitet eine Nachricht weiter. */
export async function forwardMail(args: {
  mailbox: string;
  messageId: string;
  to: string[];
  cc?: string[];
  comment: string;
}): Promise<void> {
  const url = `${GRAPH}/users/${encodeURIComponent(args.mailbox)}/messages/${encodeURIComponent(args.messageId)}/forward`;
  const recipients = (xs: string[]): MailRecipient[] =>
    xs.map((a) => ({ emailAddress: { address: a } }));
  const payload = {
    toRecipients: recipients(args.to),
    ccRecipients: args.cc && args.cc.length > 0 ? recipients(args.cc) : undefined,
    comment: args.comment,
  };
  const resp = await graphFetch('POST', url, payload);
  if (!resp.ok) throw new Error(`forwardMail: ${resp.status} ${await resp.text()}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Server-Node hat Buffer
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  // Browser-Fallback (eigentlich nur server, aber sicher ist sicher)
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}
