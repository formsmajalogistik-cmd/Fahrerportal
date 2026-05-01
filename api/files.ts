// GET /api/files?folder=<onedrive-folder-path>
// Listet die Items im Ordner.

import { listChildren } from '../server-lib/graph.js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
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
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    await getAuthedUser(asString(req.headers?.authorization));
    const folder = asString(req.query?.folder) ?? '';
    if (folder.includes('..')) { res.status(400).json({ error: 'Ungültiger Pfad' }); return; }
    const items = await listChildren(folder);
    res.status(200).json({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        size: i.size,
        webUrl: i.webUrl,
        isFolder: !!i.folder,
        mimeType: i.file?.mimeType,
      })),
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/files]', err);
    res.status(status).json({ error: msg });
  }
}
