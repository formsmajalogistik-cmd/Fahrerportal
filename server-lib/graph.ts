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

/** Versendet eine Email vom konfigurierten Postfach aus. */
export async function sendMail(args: {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
}): Promise<void> {
  const upn = env('ONEDRIVE_USER_EMAIL');
  const url = `${GRAPH}/users/${encodeURIComponent(upn)}/sendMail`;
  const recipients = (xs: string[]): MailRecipient[] =>
    xs.map((a) => ({ emailAddress: { address: a } }));

  const att: MailAttachment[] = (args.attachments ?? []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: bytesToBase64(a.bytes),
  }));

  const body = {
    message: {
      subject: args.subject,
      body: { contentType: 'Text', content: args.bodyText },
      toRecipients: recipients(args.to),
      ccRecipients: args.cc && args.cc.length > 0 ? recipients(args.cc) : undefined,
      attachments: att.length > 0 ? att : undefined,
    },
    saveToSentItems: true,
  };

  const resp = await graphFetch('POST', url, body);
  if (!resp.ok) throw new Error(`sendMail: ${resp.status} ${await resp.text()}`);
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
