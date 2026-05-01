// POST /api/upload
// Body (JSON):
//   { path: string, contentType: string, content_base64: string }
// Antwort:
//   { ok: true, path, item: { id, webUrl, name } }
//
// Auth: Supabase-Bearer-Token. Pfad ist relativ zur OneDrive-Wurzel.

import { uploadFile } from '../server-lib/graph';
import { getAuthedUser, HttpError } from '../server-lib/auth';

interface UploadBody {
  path: string;
  contentType: string;
  content_base64: string;
}

function fail(res: { status: (n: number) => { json: (b: unknown) => unknown } }, status: number, msg: string) {
  res.status(status).json({ error: msg });
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return fail(res, 405, 'Method Not Allowed');
  try {
    await getAuthedUser(asString(req.headers?.authorization));
    const body = (req.body || {}) as Partial<UploadBody>;
    if (!body.path || !body.contentType || !body.content_base64) {
      return fail(res, 400, 'path / contentType / content_base64 erforderlich');
    }
    if (body.path.includes('..') || body.path.startsWith('/')) {
      return fail(res, 400, 'Ungültiger Pfad');
    }
    const bytes = base64ToBytes(body.content_base64);
    const item = await uploadFile(body.path, bytes, body.contentType);
    res.status(200).json({
      ok: true,
      path: body.path,
      item: { id: item.id, webUrl: item.webUrl, name: item.name },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/upload]', err);
    fail(res, status, msg);
  }
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.split(',').pop()! : b64;
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  // Fallback (sollte serverseitig nicht greifen)
  // eslint-disable-next-line no-undef
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => { json: (b: unknown) => unknown; send: (b: unknown) => unknown };
  setHeader: (k: string, v: string) => void;
}
