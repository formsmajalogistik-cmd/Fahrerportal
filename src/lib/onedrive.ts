// Frontend-Client für die /api-Routen, die das OneDrive über Microsoft Graph
// bedienen. Alle Calls laufen mit dem Supabase-Bearer-Token im Header.

import { supabase } from './supabase';
import { fetchWithRetry } from './fetchRetry';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  // Browser: kein Buffer. atob/btoa arbeiten mit binary strings.
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

// Vercel-Function-Body-Limit: 4.5 MB. JSON+base64 inflieren um ~33 %,
// also alles über ~3 MB binär nicht mehr durch /api/upload prügeln —
// stattdessen Microsoft-Graph-Upload-Session: Server liefert nur die
// signierte URL, der Browser PUTet die Datei direkt zu Microsoft.
const DIRECT_UPLOAD_THRESHOLD = 3 * 1024 * 1024;

export async function uploadToOneDrive(
  path: string, file: Blob,
): Promise<{ ok: true; path: string; webUrl?: string }> {
  if (file.size > DIRECT_UPLOAD_THRESHOLD) {
    return await uploadViaSession(path, file);
  }
  const buf = await file.arrayBuffer();
  const b64 = await bytesToBase64(new Uint8Array(buf));
  // Uploads sind groß und langsam → längeres Timeout als der 15-s-Default.
  const resp = await fetchWithRetry('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      path,
      contentType: file.type || 'application/octet-stream',
      content_base64: b64,
    }),
    timeoutMs: 60_000,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    // 413 → Datei doch zu groß für JSON-Pfad: einmal über Session retry.
    if (resp.status === 413) {
      console.warn('[uploadToOneDrive] /api/upload 413 → Session-Fallback');
      return await uploadViaSession(path, file);
    }
    throw new Error(`Upload (${resp.status}): ${txt.slice(0, 200)}`);
  }
  return await resp.json();
}

/**
 * Holt eine Microsoft-Graph-Upload-Session vom Server und PUTet die
 * Datei direkt zu Microsoft. Bei großen Dateien wird in 5-MB-Chunks
 * hochgeladen (Graph erwartet Content-Range pro Chunk). Bei kleineren
 * Dateien reicht ein einzelner PUT.
 */
async function uploadViaSession(
  path: string, file: Blob,
): Promise<{ ok: true; path: string; webUrl?: string }> {
  const sess = await fetchWithRetry('/api/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ path }),
    timeoutMs: 30_000,
  });
  if (!sess.ok) {
    throw new Error(`upload-session (${sess.status}): ${(await sess.text()).slice(0, 200)}`);
  }
  const { uploadUrl } = (await sess.json()) as { uploadUrl: string };

  const total = file.size;
  const CHUNK = 5 * 1024 * 1024; // Graph empfiehlt 5–10 MB-Chunks
  let offset = 0;
  let last: { id?: string; webUrl?: string } | null = null;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    const slice = file.slice(offset, end);
    // Wichtig: KEIN auth-Header bei diesem PUT — uploadUrl ist signiert.
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - offset),
        'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
      },
      body: slice,
    });
    if (!r.ok && r.status !== 202) {
      throw new Error(`Chunk-Upload (${r.status}): ${(await r.text()).slice(0, 200)}`);
    }
    if (r.status === 200 || r.status === 201) {
      last = await r.json() as { id?: string; webUrl?: string };
    }
    offset = end;
  }
  return { ok: true, path, webUrl: last?.webUrl };
}

export async function downloadFromOneDrive(
  path: string, opts?: { formularId?: string | null },
): Promise<Blob> {
  const qs = new URLSearchParams({ path });
  if (opts?.formularId) qs.set('formular_id', opts.formularId);
  const resp = await fetchWithRetry(
    `/api/download?${qs.toString()}`,
    { headers: await authHeader(), timeoutMs: 60_000 },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.warn(
      `[onedrive.download] ${resp.status} ${resp.statusText} path=${path}`
      + (opts?.formularId ? ` formular=${opts.formularId}` : '')
      + (text ? ` body=${text.slice(0, 200)}` : ''),
    );
    throw new Error(`Download fehlgeschlagen (${resp.status})`);
  }
  return await resp.blob();
}

/** Lädt eine Datei aus OneDrive und triggert einen Browser-Download mit Wunsch-Filename. */
export async function triggerOneDriveDownload(
  path: string, filename: string, opts?: { formularId?: string | null },
): Promise<boolean> {
  try {
    const blob = await downloadFromOneDrive(path, opts);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (err) {
    console.warn('triggerOneDriveDownload', err);
    return false;
  }
}

/**
 * Öffnet die PDF als Vorschau in einem neuen Tab. Damit der Browser die
 * Datei inline anzeigen kann, holen wir sie als Blob (mit Bearer-Header)
 * und öffnen die resultierende Object-URL — so muss der Token nicht in
 * die URL gehängt werden und Vercel kann den Cache-Header korrekt setzen.
 */
export async function previewOneDrivePdf(
  path: string, opts?: { formularId?: string | null },
): Promise<boolean> {
  try {
    const qs = new URLSearchParams({ path, inline: '1' });
    if (opts?.formularId) qs.set('formular_id', opts.formularId);
    const resp = await fetchWithRetry(
      `/api/download?${qs.toString()}`,
      { headers: await authHeader(), timeoutMs: 60_000 },
    );
    if (!resp.ok) throw new Error(`Vorschau fehlgeschlagen (${resp.status})`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // Pop-up geblockt: Fallback auf Download.
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch (err) {
    console.warn('previewOneDrivePdf', err);
    return false;
  }
}

/**
 * Liefert eine Object-URL für die Datei aus OneDrive — geeignet für <img src>.
 * Achtung: muss vom Aufrufer mit URL.revokeObjectURL freigegeben werden.
 */
export async function getOneDriveObjectUrl(
  path: string, opts?: { formularId?: string | null },
): Promise<string | null> {
  try {
    const blob = await downloadFromOneDrive(path, opts);
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('getOneDriveObjectUrl', err);
    return null;
  }
}

/**
 * Löscht eine Datei aus OneDrive. Nutzt /api/delete-pdf mit derselben
 * Pro-Resource-Authorisierung wie der Download.
 */
export async function deleteFromOneDrive(path: string, formularId: string): Promise<boolean> {
  try {
    const resp = await fetchWithRetry('/api/delete-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ path, formular_id: formularId }),
      timeoutMs: 30_000,
    });
    return resp.ok;
  } catch (err) {
    console.warn('deleteFromOneDrive', err);
    return false;
  }
}

export interface SendEmailResult {
  /** Dateinamen von Anhängen, die der Server nach Retries nicht laden konnte.
   *  Die Mail wurde trotzdem versendet (mit Hinweis im Body). */
  missing: string[];
  attached: number;
}

export async function sendEmail(args: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments: Array<{ name: string; contentType: string; onedrive_path: string }>;
}): Promise<SendEmailResult> {
  const resp = await fetchWithRetry('/api/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Email-Versand fehlgeschlagen (${resp.status}): ${txt.slice(0, 200)}`);
  }
  const json = await resp.json().catch(() => ({})) as Partial<SendEmailResult>;
  return {
    missing: Array.isArray(json.missing) ? json.missing : [],
    attached: typeof json.attached === 'number' ? json.attached : 0,
  };
}
