// /api/emails — Posteingang-Listing (GET) + neue Mail senden (POST).
//
//   GET  /api/emails?mailbox=foo@bar.de&page=1&pageSize=20[&search=...]
//   POST /api/emails  body: { mailbox, to[], cc?, subject, bodyHtml, attachments? }
//
// Beide Pfade prüfen Admin-Auth und dass `mailbox` zu den in
// app_settings hinterlegten Adressen gehört (siehe mailboxAuth.ts).
// Attachments im POST-Body sind base64 + name + contentType.

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertMailboxAllowed } from '../server-lib/mailboxAuth.js';
import { listMessages, sendMailFrom } from '../server-lib/graph.js';

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

export default async function handler(req: Req, res: Res) {
  try {
    const auth = asString(req.headers?.authorization as string | undefined);
    const user = await getAuthedUser(auth);
    if (user.role !== 'admin') throw new HttpError(403, 'Nur Admins');
    const token = (auth ?? '').replace(/^bearer\s+/i, '');

    if (req.method === 'GET') {
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

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object')
        ? req.body as Record<string, unknown>
        : {};
      const mailbox = asString(body.mailbox);
      if (!mailbox) throw new HttpError(400, 'mailbox fehlt');
      await assertMailboxAllowed(token, mailbox);
      const to = asStringArray(body.to);
      if (to.length === 0) throw new HttpError(400, 'Mindestens ein Empfänger ist erforderlich');
      const cc = asStringArray(body.cc);
      const subject = asString(body.subject) ?? '';
      const bodyHtml = asString(body.bodyHtml) ?? '';
      // attachments[]: { name, contentType, content_base64 }
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
      await sendMailFrom({ mailbox, to, cc: cc.length > 0 ? cc : undefined, subject, bodyHtml, attachments: atts });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/emails]', err);
    res.status(status).json({ error: msg });
  }
}
