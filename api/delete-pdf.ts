// POST /api/delete-pdf  { path: string, formular_id: string }
//
// Löscht eine OneDrive-Datei. Authorization: gleich wie /api/download —
// Pfad muss zum mitgegebenen Formular gehören und der User muss es
// sehen dürfen. Wird vom Frontend für Zwischenprotokoll-Löschen genutzt
// (manuelles Entfernen UND automatisches Aufräumen nach Submit).

import { deleteFile } from '../server-lib/graph.js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertCanAccessPdfPath } from '../server-lib/formularAuth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: unknown) => void;
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

    const body = (req.body && typeof req.body === 'object')
      ? req.body as Record<string, unknown>
      : {};
    const path = asString(body.path);
    const formularId = asString(body.formular_id);
    if (!path || path.includes('..') || !formularId) {
      res.status(400).json({ error: 'path und formular_id sind Pflicht' });
      return;
    }

    await assertCanAccessPdfPath(user, formularId, path);
    await deleteFile(path);

    res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/delete-pdf]', err);
    res.status(status).json({ error: msg });
  }
}
