// GET /api/download?path=<onedrive-path>&filename=<optional>
// Liefert die Datei-Bytes mit Content-Disposition (Filename) zurück.
// Auth: Supabase-Bearer-Token (im Header Authorization, sonst per ?token= als Fallback,
// damit man die URL z.B. in einem <a target="_blank"> verwenden könnte).

import { downloadFile } from '../server-lib/graph.js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  send: (b: unknown) => void;
  json: (b: unknown) => void;
  end: (b?: unknown) => void;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const auth = asString(req.headers?.authorization)
      ?? (asString(req.query?.token) ? `Bearer ${asString(req.query?.token)}` : null);
    await getAuthedUser(auth);

    const path = asString(req.query?.path);
    if (!path || path.includes('..')) {
      res.status(400).json({ error: 'Ungültiger oder fehlender Pfad' });
      return;
    }
    const filename = asString(req.query?.filename) || path.split('/').pop() || 'download';

    const { bytes, contentType } = await downloadFile(path);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.send(Buffer.from(bytes) as any);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/download]', err);
    res.status(status).json({ error: msg });
  }
}
