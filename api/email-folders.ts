// GET /api/email-folders?mailbox=...
// Liefert die Ordner eines Postfachs (Well-Known + benutzerdefiniert).

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertMailboxAllowed } from '../server-lib/mailboxAuth.js';
import { listFolders } from '../server-lib/graph.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}
interface Res {
  status: (n: number) => Res;
  json: (b: unknown) => void;
}

function qString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const auth = asString(req.headers?.authorization as string | undefined);
    const user = await getAuthedUser(auth);
    if (user.role !== 'admin') throw new HttpError(403, 'Nur Admins');
    const token = (auth ?? '').replace(/^bearer\s+/i, '');
    const mailbox = qString(req.query?.mailbox);
    if (!mailbox) throw new HttpError(400, 'mailbox-Query fehlt');
    await assertMailboxAllowed(token, mailbox);
    const folders = await listFolders(mailbox);
    res.status(200).json({ value: folders });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/email-folders]', err);
    res.status(status).json({ error: msg });
  }
}
