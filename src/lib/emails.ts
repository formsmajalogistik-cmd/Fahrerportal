// Client-Helper für den konsolidierten /api/emails-Endpunkt. Alle
// Aktionen routen via ?action=… auf dieselbe Vercel-Function (siehe
// Vercel-Hobby-Limit von 12 Functions).

import { getValidToken } from './supabase';
import { fetchWithRetry } from './fetchRetry';

export interface MailListItem {
  id: string;
  subject: string;
  from: { name: string | null; address: string | null };
  receivedDateTime: string;
  bodyPreview: string;
  hasAttachments: boolean;
  isRead: boolean;
  flagged: boolean;
}

export interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  totalItemCount: number;
  unreadItemCount: number;
  wellKnown: string | null;
}

export interface MailAttachmentMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface MailDetail extends MailListItem {
  to: Array<{ name: string | null; address: string | null }>;
  cc: Array<{ name: string | null; address: string | null }>;
  bodyHtml: string;
  bodyContentType: 'html' | 'text';
  attachments: MailAttachmentMeta[];
}

export class MailError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getValidToken();
  if (!token) throw new MailError(401, 'Sitzung abgelaufen — bitte neu anmelden.');
  return { Authorization: `Bearer ${token}` };
}

async function expectJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json() as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* nicht JSON */ }
    throw new MailError(resp.status, msg);
  }
  return resp.json() as Promise<T>;
}

async function postAction(action: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<void> {
  const resp = await fetchWithRetry(`/api/emails?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs,
  });
  await expectJson(resp);
}

async function getAction<T>(action: string, params: URLSearchParams, timeoutMs = 25_000): Promise<T> {
  params.set('action', action);
  const resp = await fetchWithRetry(`/api/emails?${params.toString()}`, {
    headers: await authHeader(),
    timeoutMs,
  });
  return expectJson<T>(resp);
}

export async function listEmails(args: {
  mailbox: string;
  page?: number;
  pageSize?: number;
  search?: string;
  folder?: string;
  /** Focused Inbox: 'focused' = Relevant, 'other' = Sonstige. */
  classification?: 'focused' | 'other';
  /** Nur ungelesene Nachrichten — wird für Tab-Badge-Counts genutzt. */
  onlyUnread?: boolean;
}): Promise<{ value: MailListItem[]; totalCount?: number; classificationSupported?: boolean }> {
  const params = new URLSearchParams();
  params.set('mailbox', args.mailbox);
  if (args.page) params.set('page', String(args.page));
  if (args.pageSize != null) params.set('pageSize', String(args.pageSize));
  if (args.search) params.set('search', args.search);
  if (args.folder) params.set('folder', args.folder);
  if (args.classification) params.set('classification', args.classification);
  if (args.onlyUnread) params.set('onlyUnread', '1');
  return getAction('list', params);
}

export async function listFolders(mailbox: string): Promise<MailFolder[]> {
  const j = await getAction<{ value: MailFolder[] }>('folders', new URLSearchParams({ mailbox }));
  return j.value;
}

export async function moveEmail(args: {
  mailbox: string; messageId: string; destinationId: string;
}): Promise<void> {
  await postAction('move', args, 25_000);
}

export async function deleteEmail(args: {
  mailbox: string; messageId: string;
}): Promise<void> {
  await postAction('delete', args, 25_000);
}

export async function flagEmail(args: {
  mailbox: string; messageId: string; flagged: boolean;
}): Promise<void> {
  await postAction('flag', args, 25_000);
}

export async function markEmailRead(args: {
  mailbox: string; messageId: string; isRead: boolean;
}): Promise<void> {
  await postAction('markRead', args, 25_000);
}

export async function getEmail(mailbox: string, id: string): Promise<MailDetail> {
  return getAction('message', new URLSearchParams({ mailbox, id }));
}

/**
 * Lädt einen Anhang als Blob — die Bytes werden nicht über das DOM
 * adressiert, sondern intern als blob-URL erzeugt; der Bearer-Token
 * bleibt im Authorization-Header (nicht in der URL).
 */
export async function fetchAttachmentBlob(args: {
  mailbox: string; messageId: string; attachmentId: string;
  disposition?: 'inline' | 'attachment';
}): Promise<Blob> {
  const params = new URLSearchParams({
    action: 'attachment',
    mailbox: args.mailbox,
    messageId: args.messageId,
    attachmentId: args.attachmentId,
  });
  if (args.disposition) params.set('disposition', args.disposition);
  const resp = await fetchWithRetry(`/api/emails?${params.toString()}`, {
    headers: await authHeader(),
    timeoutMs: 40_000,
  });
  if (!resp.ok) {
    throw new MailError(resp.status, `HTTP ${resp.status}`);
  }
  return resp.blob();
}

export interface OutboundAttachment {
  name: string;
  contentType: string;
  content_base64: string;
}

export async function sendEmailFrom(args: {
  mailbox: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  attachments?: OutboundAttachment[];
}): Promise<void> {
  await postAction('send', args, 60_000);
}

export async function replyToEmail(args: {
  mailbox: string;
  messageId: string;
  bodyHtml: string;
  to?: string[];
  cc?: string[];
  attachments?: OutboundAttachment[];
}): Promise<void> {
  await postAction('reply', args, 60_000);
}

export async function forwardEmail(args: {
  mailbox: string;
  messageId: string;
  to: string[];
  cc?: string[];
  comment: string;
}): Promise<void> {
  await postAction('forward', args, 60_000);
}

/** Liest einen File-Blob in OutboundAttachment um. */
export async function fileToOutboundAttachment(file: File): Promise<OutboundAttachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return {
    name: file.name,
    contentType: file.type || 'application/octet-stream',
    content_base64: btoa(bin),
  };
}

/**
 * Formatiert ein ISO-Datum als deutsche relative oder absolute
 * Zeitangabe. < 1 Std → "vor X Min.", < 24 h → "vor X Std.",
 * heute → "Heute HH:MM", sonst "dd.mm.yyyy HH:MM".
 */
export function formatMailDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const hours = Math.floor(min / 60);
  if (hours < 24 && d.getDate() === now.getDate()) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `Heute ${hh}:${mm}`;
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min2 = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min2}`;
}

/** Formatiert Byte-Größen knapp ("23 KB", "1,2 MB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const decimals = v < 10 && i > 0 ? 1 : 0;
  return `${v.toFixed(decimals).replace('.', ',')} ${units[i]}`;
}
