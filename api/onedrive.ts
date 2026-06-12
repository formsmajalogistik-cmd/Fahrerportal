// Konsolidierter OneDrive-Endpoint — Upload, Download, Delete, List
// und Upload-Session laufen alle hier durch (Vercel-Hobby-Limit von
// 12 Functions).
//
// Routing über ?action=<name>:
//   upload         POST  body: { path, contentType, content_base64 }
//   upload-session POST  body: { path }                  → liefert uploadUrl
//   download       GET   ?path=&filename=&formular_id=&inline=1
//                  (auch ohne action: für direkte Browser-Links)
//   delete-pdf     POST  body: { path, formular_id }
//   files          GET   ?folder=
//
// Browser-direkt-Links (window.location.href) gehen über GET; das
// ?action= kann fehlen, wir interpretieren GET ohne action automatisch
// als "download" (= alter /api/download-Pfad).

import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { assertCanAccessPdfPath } from '../server-lib/formularAuth.js';
import {
  createUploadSession, deleteFile, downloadFile, listChildren, uploadFile,
} from '../server-lib/graph.js';

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
  send?: (b: unknown) => void;
}

function qString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return null;
}
function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}
/**
 * Upload-Pfad-Whitelist pro Rolle. Auftraggeber-Profile (externe Kunden)
 * dürfen ausschließlich Formular-Wünsche ablegen — alle anderen
 * OneDrive-Bereiche (Formulare, Belege, Rechnungen, …) sind tabu.
 * Admin/Fahrer behalten das bisherige Verhalten.
 */
function assertUploadPathAllowed(role: string | null, path: string): void {
  if (role === 'auftraggeber' && !path.startsWith('Maja-Logistik/Formular-Wuensche/')) {
    throw new HttpError(403, 'Upload-Pfad für Auftraggeber-Profile nicht erlaubt');
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.split(',').pop()! : b64;
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export default async function handler(req: Req, res: Res) {
  try {
    const method = (req.method ?? 'GET').toUpperCase();
    const action = qString(req.query?.action)
      ?? (method === 'GET' ? 'download' : '');

    // Download akzeptiert Token via Query — damit Browser-direkt-Links
    // (<a target=_blank>) funktionieren. Andere Actions verlangen den
    // Header.
    const headerAuth = asString(req.headers?.authorization as string | undefined);
    const queryToken = qString(req.query?.token);
    const auth = headerAuth ?? (queryToken ? `Bearer ${queryToken}` : null);
    const user = await getAuthedUser(auth);
    const token = (auth ?? '').replace(/^bearer\s+/i, '');

    // ---- DOWNLOAD ---------------------------------------------------
    if (method === 'GET' && action === 'download') {
      const path = qString(req.query?.path);
      if (!path || path.includes('..')) {
        throw new HttpError(400, 'Ungültiger oder fehlender Pfad');
      }
      const filename = qString(req.query?.filename) || path.split('/').pop() || 'download';
      const formularId = qString(req.query?.formular_id);
      const inline = qString(req.query?.inline) === '1';

      console.info('[Download] User:', {
        userId: user.id,
        role: user.role,
        isAdmin: user.role === 'admin',
        formularId,
        path,
      });

      if (formularId) {
        await assertCanAccessPdfPath(user, token, formularId, path);
      } else if (user.role === 'admin') {
        // Admin-Dokumente (z.B. Rechnungs-PDFs) ohne formular_id ok.
      } else {
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
      if (res.send) res.send(Buffer.from(bytes) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else res.end(Buffer.from(bytes) as any);
      return;
    }

    // ---- FILES (List) ----------------------------------------------
    if (method === 'GET' && action === 'files') {
      // Auftraggeber-Profile (externe Kunden) dürfen keine OneDrive-
      // Ordner durchsuchen.
      if (user.role === 'auftraggeber') {
        throw new HttpError(403, 'Kein Zugriff für Auftraggeber-Profile');
      }
      const folder = qString(req.query?.folder) ?? '';
      if (folder.includes('..')) throw new HttpError(400, 'Ungültiger Pfad');
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
      return;
    }

    if (method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const body = (req.body && typeof req.body === 'object')
      ? req.body as Record<string, unknown>
      : {};

    // ---- UPLOAD -----------------------------------------------------
    if (action === 'upload') {
      const path = asString(body.path);
      const contentType = asString(body.contentType);
      const contentB64 = asString(body.content_base64);
      if (!path || !contentType || !contentB64) {
        throw new HttpError(400, 'path / contentType / content_base64 erforderlich');
      }
      if (path.includes('..') || path.startsWith('/')) {
        throw new HttpError(400, 'Ungültiger Pfad');
      }
      assertUploadPathAllowed(user.role, path);
      const bytes = base64ToBytes(contentB64);
      const item = await uploadFile(path, bytes, contentType);
      res.status(200).json({
        ok: true,
        path,
        item: { id: item.id, webUrl: item.webUrl, name: item.name },
      });
      return;
    }

    // ---- UPLOAD-SESSION --------------------------------------------
    if (action === 'upload-session') {
      const path = (asString(body.path) ?? '').trim();
      if (!path || path.includes('..')) {
        throw new HttpError(400, 'Pfad ungültig');
      }
      assertUploadPathAllowed(user.role, path);
      const { uploadUrl } = await createUploadSession(path);
      res.status(200).json({ ok: true, uploadUrl });
      return;
    }

    // ---- DELETE-PDF -------------------------------------------------
    if (action === 'delete-pdf') {
      // Auftraggeber-Profile haben Read-Only-Zugriff auf Protokolle.
      if (user.role === 'auftraggeber') {
        throw new HttpError(403, 'Kein Lösch-Zugriff für Auftraggeber-Profile');
      }
      const path = asString(body.path);
      const formularId = asString(body.formular_id);
      if (!path || path.includes('..') || !formularId) {
        throw new HttpError(400, 'path und formular_id sind Pflicht');
      }
      await assertCanAccessPdfPath(user, token, formularId, path);
      await deleteFile(path);
      res.status(200).json({ ok: true });
      return;
    }

    throw new HttpError(400, `Unbekannte Action: ${action}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/onedrive]', err);
    res.status(status).json({ error: msg });
  }
}
