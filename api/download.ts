// GET /api/download?path=<onedrive-path>&filename=<optional>
//                   &formular_id=<uuid>&inline=1
//
// Liefert die Datei-Bytes mit Content-Disposition zurück. `inline=1`
// erzeugt eine Vorschau-Disposition (Browser zeigt PDF inline statt
// Download). Wenn `formular_id` mitgegeben ist, prüft der Server, ob
// der User das Formular sehen darf UND ob der Pfad zu diesem Formular
// gehört (Ordner-Prefix ODER zwischenprotokoll_url). Ohne formular_id
// gilt das alte Verhalten: jeder eingeloggte User darf jeden Pfad
// laden — Admin-Tools / interne Aufrufer.
//
// Auth: Supabase-Bearer-Token (Header `Authorization` oder als Fallback
// `?token=`, damit man die URL in `<a target="_blank">` nutzen kann).

import { downloadFile } from '../server-lib/graph.js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertCanAccessPdfPath } from '../server-lib/formularAuth.js';

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
    const user = await getAuthedUser(auth);
    const token = (auth ?? '').replace(/^bearer\s+/i, '');

    const path = asString(req.query?.path);
    if (!path || path.includes('..')) {
      res.status(400).json({ error: 'Ungültiger oder fehlender Pfad' });
      return;
    }
    const filename = asString(req.query?.filename) || path.split('/').pop() || 'download';
    const formularId = asString(req.query?.formular_id);
    const inline = asString(req.query?.inline) === '1';

    if (formularId) {
      // Protokoll-/Formular-PDF: Pro-Resource-Auth über formular_id.
      await assertCanAccessPdfPath(user, token, formularId, path);
    } else if (user.role === 'admin') {
      // Admin-Dokumente (z.B. Rechnungs-PDFs unter Maja-Logistik/Rechnungen/)
      // dürfen ohne formular_id geladen werden — der Admin sieht ohnehin
      // alles.
    } else {
      // Nicht-Admin ohne formular_id → kein Zugriff.
      throw new HttpError(
        403,
        `Kein Zugriff (Rolle=${user.role ?? 'unbekannt'}). Bei Protokoll-PDFs `
        + 'muss formular_id mitgegeben werden; Admin-Dokumente sind '
        + 'Fahrern nicht zugänglich.',
      );
    }

    const { bytes, contentType } = await downloadFile(path);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.send(Buffer.from(bytes) as any);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/download]', err);
    res.status(status).json({ error: msg });
  }
}
