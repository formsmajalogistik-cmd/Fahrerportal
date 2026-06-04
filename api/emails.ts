// Konsolidierter E-Mail-Endpoint — alle Postfach-Operationen laufen
// hier durch (Aufgabe: Vercel-Hobby-Limit von 12 Functions).
//
// Routing über ?action=<name>:
//
//   list         GET   ?action=list&mailbox=&page=&pageSize=&search=&folder=
//   folders      GET   ?action=folders&mailbox=
//   message      GET   ?action=message&mailbox=&id=
//   attachment   GET   ?action=attachment&mailbox=&messageId=&attachmentId=&disposition=
//   send         POST  ?action=send       body: { mailbox, to[], cc?, subject, bodyHtml, attachments? }
//   reply        POST  ?action=reply      body: { mailbox, messageId, bodyHtml, to?, cc?, attachments? }
//   forward      POST  ?action=forward    body: { mailbox, messageId, to[], cc?, comment }
//   move         POST  ?action=move       body: { mailbox, messageId, destinationId }
//   flag         POST  ?action=flag       body: { mailbox, messageId, flagged }
//   delete       POST  ?action=delete     body: { mailbox, messageId }
//   markRead     POST  ?action=markRead   body: { mailbox, messageId, isRead }
//   eingang-send POST  ?action=eingang-send body: { to[], cc?, subject, body, attachments?[{ name, contentType, onedrive_path }] }
//
// Alle Aktionen prüfen Admin-Auth + Mailbox-Whitelist (sofern Mailbox-Argument).
// eingang-send nutzt das im env hinterlegte ONEDRIVE_USER_EMAIL und lädt
// die Anhänge aus OneDrive.

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertMailboxAllowed } from '../server-lib/mailboxAuth.js';
import {
  downloadFile, forwardMail, getAttachmentBytes, getMessage,
  listFolders, listMessages, moveMessage, patchMessage,
  replyMail, sendMail, sendMailFrom,
} from '../server-lib/graph.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: unknown) => void;
  send?: (b: unknown) => void;
}

function qString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

interface AttachIn { name: string; contentType: string; content_base64: string }
function decodeAttachments(v: unknown): Array<{ name: string; contentType: string; bytes: Uint8Array }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [];
  for (const raw of v as Partial<AttachIn>[]) {
    const name = typeof raw.name === 'string' ? raw.name : null;
    const ctype = typeof raw.contentType === 'string' ? raw.contentType : 'application/octet-stream';
    const b64 = typeof raw.content_base64 === 'string' ? raw.content_base64 : null;
    if (!name || !b64) continue;
    const bytes = typeof Buffer !== 'undefined'
      ? new Uint8Array(Buffer.from(b64, 'base64'))
      : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    out.push({ name, contentType: ctype, bytes });
  }
  return out;
}

async function downloadWithRetry(path: string, attempts: number): Promise<Uint8Array | null> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { bytes } = await downloadFile(path);
      if (i > 0) console.info(`[/api/emails:eingang-send] Anhang nach ${i + 1}. Versuch geladen: ${path}`);
      return bytes;
    } catch (err) {
      const isLast = i === attempts - 1;
      console.warn(
        `[/api/emails:eingang-send] Anhang Versuch ${i + 1}/${attempts} fehlgeschlagen (${path}):`,
        err instanceof Error ? err.message : err,
      );
      if (isLast) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return null;
}

export default async function handler(req: Req, res: Res) {
  try {
    const auth = asString(req.headers?.authorization as string | undefined);
    const user = await getAuthedUser(auth);
    if (user.role !== 'admin') throw new HttpError(403, 'Nur Admins');
    const token = (auth ?? '').replace(/^bearer\s+/i, '');

    const action = qString(req.query?.action) ?? '';
    const body = (req.body && typeof req.body === 'object')
      ? req.body as Record<string, unknown>
      : {};

    // ---- GET ---------------------------------------------------------
    if (req.method === 'GET') {
      if (action === 'list' || action === '') {
        const mailbox = qString(req.query?.mailbox);
        if (!mailbox) throw new HttpError(400, 'mailbox-Query fehlt');
        await assertMailboxAllowed(token, mailbox);
        const page = Number(qString(req.query?.page) ?? '1') || 1;
        const pageSize = Number(qString(req.query?.pageSize) ?? '20') || 20;
        const search = qString(req.query?.search);
        const folder = qString(req.query?.folder) ?? 'inbox';
        const result = await listMessages({ mailbox, folder, page, pageSize, search });
        res.status(200).json(result);
        return;
      }
      if (action === 'folders') {
        const mailbox = qString(req.query?.mailbox);
        if (!mailbox) throw new HttpError(400, 'mailbox-Query fehlt');
        await assertMailboxAllowed(token, mailbox);
        const folders = await listFolders(mailbox);
        res.status(200).json({ value: folders });
        return;
      }
      if (action === 'message') {
        const mailbox = qString(req.query?.mailbox);
        const id = qString(req.query?.id);
        if (!mailbox || !id) throw new HttpError(400, 'mailbox und id sind Pflicht');
        await assertMailboxAllowed(token, mailbox);
        const msg = await getMessage({ mailbox, messageId: id });
        res.status(200).json(msg);
        return;
      }
      if (action === 'attachment') {
        const mailbox = qString(req.query?.mailbox);
        const messageId = qString(req.query?.messageId);
        const attachmentId = qString(req.query?.attachmentId);
        const disposition = qString(req.query?.disposition) === 'inline' ? 'inline' : 'attachment';
        if (!mailbox || !messageId || !attachmentId) {
          throw new HttpError(400, 'mailbox, messageId und attachmentId sind Pflicht');
        }
        await assertMailboxAllowed(token, mailbox);
        const { name, contentType, bytes } = await getAttachmentBytes({ mailbox, messageId, attachmentId });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(bytes.byteLength));
        res.setHeader(
          'Content-Disposition',
          `${disposition}; filename="${name.replace(/[\r\n"]/g, '')}"`,
        );
        if (res.send) res.send(Buffer.from(bytes));
        else res.end(Buffer.from(bytes));
        return;
      }
      throw new HttpError(400, `Unbekannte GET-Action: ${action}`);
    }

    // ---- POST -------------------------------------------------------
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    if (action === 'send') {
      const mailbox = asString(body.mailbox);
      if (!mailbox) throw new HttpError(400, 'mailbox fehlt');
      await assertMailboxAllowed(token, mailbox);
      const to = asStringArray(body.to);
      if (to.length === 0) throw new HttpError(400, 'Mindestens ein Empfänger ist erforderlich');
      const cc = asStringArray(body.cc);
      const subject = asString(body.subject) ?? '';
      const bodyHtml = asString(body.bodyHtml) ?? '';
      await sendMailFrom({
        mailbox, to, cc: cc.length > 0 ? cc : undefined, subject, bodyHtml,
        attachments: decodeAttachments(body.attachments),
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'reply') {
      const mailbox = asString(body.mailbox);
      const messageId = asString(body.messageId);
      if (!mailbox || !messageId) throw new HttpError(400, 'mailbox und messageId sind Pflicht');
      await assertMailboxAllowed(token, mailbox);
      const bodyHtml = asString(body.bodyHtml) ?? '';
      const to = asStringArray(body.to);
      const cc = asStringArray(body.cc);
      await replyMail({
        mailbox, messageId, bodyHtml,
        to: to.length > 0 ? to : undefined,
        cc: cc.length > 0 ? cc : undefined,
        attachments: decodeAttachments(body.attachments),
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'forward') {
      const mailbox = asString(body.mailbox);
      const messageId = asString(body.messageId);
      if (!mailbox || !messageId) throw new HttpError(400, 'mailbox und messageId sind Pflicht');
      await assertMailboxAllowed(token, mailbox);
      const to = asStringArray(body.to);
      if (to.length === 0) throw new HttpError(400, 'forward braucht mindestens einen Empfänger');
      const cc = asStringArray(body.cc);
      const comment = asString(body.comment) ?? '';
      await forwardMail({
        mailbox, messageId, to,
        cc: cc.length > 0 ? cc : undefined,
        comment,
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'move' || action === 'delete') {
      const mailbox = asString(body.mailbox);
      const messageId = asString(body.messageId);
      if (!mailbox || !messageId) throw new HttpError(400, 'mailbox und messageId sind Pflicht');
      await assertMailboxAllowed(token, mailbox);
      const destinationId = action === 'delete'
        ? 'deleteditems'
        : asString(body.destinationId);
      if (!destinationId) throw new HttpError(400, 'destinationId fehlt');
      await moveMessage({ mailbox, messageId, destinationId });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'flag') {
      const mailbox = asString(body.mailbox);
      const messageId = asString(body.messageId);
      if (!mailbox || !messageId) throw new HttpError(400, 'mailbox und messageId sind Pflicht');
      await assertMailboxAllowed(token, mailbox);
      await patchMessage({ mailbox, messageId, flagged: body.flagged === true });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'markRead') {
      const mailbox = asString(body.mailbox);
      const messageId = asString(body.messageId);
      if (!mailbox || !messageId) throw new HttpError(400, 'mailbox und messageId sind Pflicht');
      await assertMailboxAllowed(token, mailbox);
      await patchMessage({ mailbox, messageId, isRead: body.isRead === true });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'eingang-send') {
      // Legacy-Pfad: Eingangs-PDFs aus OneDrive anhängen + via default-
      // Postfach (ONEDRIVE_USER_EMAIL) verschicken. Whitelist-Check
      // entfällt hier — das Postfach ist serverseitig fest.
      const to = asStringArray(body.to);
      if (to.length === 0) throw new HttpError(400, 'Mindestens ein Empfänger nötig');
      const cc = asStringArray(body.cc);
      const subject = asString(body.subject);
      if (!subject) throw new HttpError(400, 'Betreff fehlt');
      type RawAtt = { name?: unknown; contentType?: unknown; onedrive_path?: unknown };
      const requested = Array.isArray(body.attachments)
        ? (body.attachments as RawAtt[]).filter((a) =>
            typeof a.onedrive_path === 'string'
            && (a.onedrive_path as string).trim() !== ''
            && !(a.onedrive_path as string).includes('..'),
          )
        : [];
      const attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [];
      const failed: string[] = [];
      for (const a of requested) {
        const path = a.onedrive_path as string;
        const name = typeof a.name === 'string' ? a.name : path.split('/').pop() ?? 'anhang';
        const ctype = typeof a.contentType === 'string' ? a.contentType : 'application/octet-stream';
        const bytes = await downloadWithRetry(path, 3);
        if (!bytes) { failed.push(name); continue; }
        attachments.push({ name, contentType: ctype, bytes });
      }
      let bodyText = asString(body.body) ?? '';
      if (failed.length > 0) {
        const note = `\n\n---\nHinweis: ${failed.length} Anhang/Anhänge konnten nicht geladen werden `
          + `(${failed.join(', ')}). Bitte beim Admin nachfragen oder "E-Mail versenden" nutzen.`;
        bodyText = `${bodyText}${note}`;
      }
      await sendMail({
        to, cc: cc.length > 0 ? cc : undefined,
        subject, bodyText, attachments,
      });
      res.status(200).json({
        ok: true,
        sent_to: to,
        cc,
        attached: attachments.length,
        missing: failed,
      });
      return;
    }

    throw new HttpError(400, `Unbekannte POST-Action: ${action}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/emails]', err);
    res.status(status).json({ error: msg });
  }
}
