// POST /api/upload-session
// Body (JSON):
//   { path: string }   (z.B. "Maja-Logistik/Formulare/2026-05/.../Protokoll.pdf")
//
// Legt eine OneDrive-Upload-Session an und gibt die signierte uploadUrl
// zurück. Der Browser kann dann mit PUT direkt auf die uploadUrl die
// PDF-Bytes hochladen — das umgeht das 4.5 MB Payload-Limit von Vercel
// Functions vollständig, weil die Datei NIE durch unsere API geht.

import { createUploadSession } from '../server-lib/graph.js';
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

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    await getAuthedUser(asString(req.headers?.authorization));
    const b = (req.body ?? {}) as { path?: string };
    const path = (b.path ?? '').trim();
    if (!path || path.includes('..')) {
      res.status(400).json({ error: 'Pfad ungültig' });
      return;
    }
    const { uploadUrl } = await createUploadSession(path);
    res.status(200).json({ ok: true, uploadUrl });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/upload-session]', err);
    res.status(status).json({ error: msg });
  }
}
