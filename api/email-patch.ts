// POST /api/email-patch — Aktionen auf einer Nachricht:
//   { mailbox, messageId, action: "move",   destinationId }
//   { mailbox, messageId, action: "flag",   flagged }
//   { mailbox, messageId, action: "delete" }                // → move nach deleteditems
//   { mailbox, messageId, action: "markRead", isRead }
//
// Alle Aktionen brauchen Admin-Auth + Whitelist-Check auf das Postfach.

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertMailboxAllowed } from '../server-lib/mailboxAuth.js';
import { moveMessage, patchMessage } from '../server-lib/graph.js';

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

    if (action === 'move') {
      const destinationId = asString(body.destinationId);
      if (!destinationId) throw new HttpError(400, 'destinationId fehlt');
      await moveMessage({ mailbox, messageId, destinationId });
      res.status(200).json({ ok: true });
      return;
    }
    if (action === 'delete') {
      // Nicht permanent — Graph "deleteditems" ist der Standard-Papierkorb.
      await moveMessage({ mailbox, messageId, destinationId: 'deleteditems' });
      res.status(200).json({ ok: true });
      return;
    }
    if (action === 'flag') {
      const flagged = body.flagged === true;
      await patchMessage({ mailbox, messageId, flagged });
      res.status(200).json({ ok: true });
      return;
    }
    if (action === 'markRead') {
      const isRead = body.isRead === true;
      await patchMessage({ mailbox, messageId, isRead });
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(400, `Unbekannte action: ${action}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/email-patch]', err);
    res.status(status).json({ error: msg });
  }
}
