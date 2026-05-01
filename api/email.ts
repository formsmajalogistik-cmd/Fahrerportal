// POST /api/email
// Body (JSON):
//   {
//     to: string[], cc?: string[],
//     subject: string, body: string,
//     attachments?: Array<{ name: string; contentType: string; onedrive_path: string }>
//   }
// Lädt jede angegebene Anlage aus OneDrive und versendet die Mail über /sendMail.

import { downloadFile, sendMail } from '../server-lib/graph.js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  json: (b: unknown) => void;
}

interface AttachIn { name: string; contentType: string; onedrive_path: string }
interface EmailBody {
  to: string[]; cc?: string[];
  subject: string; body: string;
  attachments?: AttachIn[];
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    await getAuthedUser(asString(req.headers?.authorization));
    const b = (req.body ?? {}) as Partial<EmailBody>;

    const to = (b.to ?? []).map((s) => s.trim()).filter(Boolean);
    const cc = (b.cc ?? []).map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) { res.status(400).json({ error: 'Mindestens ein Empfänger nötig' }); return; }
    if (!b.subject) { res.status(400).json({ error: 'Betreff fehlt' }); return; }

    // Anhänge aus OneDrive laden
    const attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [];
    for (const a of b.attachments ?? []) {
      if (!a.onedrive_path || a.onedrive_path.includes('..')) continue;
      try {
        const { bytes } = await downloadFile(a.onedrive_path);
        attachments.push({ name: a.name, contentType: a.contentType, bytes });
      } catch (err) {
        console.warn('[/api/email] Anhang nicht ladbar', a.onedrive_path, err);
      }
    }

    await sendMail({
      to, cc: cc.length > 0 ? cc : undefined,
      subject: b.subject,
      bodyText: b.body ?? '',
      attachments,
    });

    res.status(200).json({ ok: true, sent_to: to, cc, attached: attachments.length });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/email]', err);
    res.status(status).json({ error: msg });
  }
}
