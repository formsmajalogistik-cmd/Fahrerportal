// POST /api/email-action  body: { mailbox, messageId, action: "reply" | "forward", ... }
//
//   reply:   { mailbox, messageId, bodyHtml, to?, cc?, attachments? }
//   forward: { mailbox, messageId, to[], cc?, comment, attachments? }
//
// Attachments wie bei POST /api/emails als base64.

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertMailboxAllowed } from '../server-lib/mailboxAuth.js';
import { replyMail, forwardMail } from '../server-lib/graph.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  json: (b: unknown) => void;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const auth = asString(req.headers?.authorization as string | undefined);
    const user = await getAuthedUser(auth);
    if (user.role !== 'admin') throw new HttpError(403, 'Nur Admins');
    const token = (auth ?? '').replace(/^bearer\s+/i, '');
    const body = (req.body && typeof req.body === 'object')
      ? req.body as Record<string, unknown>
      : {};
    const mailbox = asString(body.mailbox);
    const messageId = asString(body.messageId);
    const action = asString(body.action);
    if (!mailbox || !messageId || !action) {
      throw new HttpError(400, 'mailbox, messageId und action sind Pflicht');
    }
    await assertMailboxAllowed(token, mailbox);

    type RawAtt = { name?: unknown; contentType?: unknown; content_base64?: unknown };
    const atts: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [];
    if (Array.isArray(body.attachments)) {
      for (const raw of body.attachments as RawAtt[]) {
        const name = typeof raw.name === 'string' ? raw.name : null;
        const ctype = typeof raw.contentType === 'string' ? raw.contentType : 'application/octet-stream';
        const b64 = typeof raw.content_base64 === 'string' ? raw.content_base64 : null;
        if (!name || !b64) continue;
        const bytes = typeof Buffer !== 'undefined'
          ? new Uint8Array(Buffer.from(b64, 'base64'))
          : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        atts.push({ name, contentType: ctype, bytes });
      }
    }

    if (action === 'reply') {
      const bodyHtml = asString(body.bodyHtml) ?? '';
      const to = asStringArray(body.to);
      const cc = asStringArray(body.cc);
      await replyMail({
        mailbox, messageId, bodyHtml,
        to: to.length > 0 ? to : undefined,
        cc: cc.length > 0 ? cc : undefined,
        attachments: atts,
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'forward') {
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

    throw new HttpError(400, `Unbekannte action: ${action}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/email-action]', err);
    res.status(status).json({ error: msg });
  }
}
