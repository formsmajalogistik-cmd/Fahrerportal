// Frontend-Client für die /api-Routen, die das OneDrive über Microsoft Graph
// bedienen. Alle Calls laufen mit dem Supabase-Bearer-Token im Header.

import { supabase } from './supabase';

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

export async function uploadToOneDrive(
  path: string, file: Blob,
): Promise<{ ok: true; path: string; webUrl?: string }> {
  const buf = await file.arrayBuffer();
  const b64 = await bytesToBase64(new Uint8Array(buf));
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      path,
      contentType: file.type || 'application/octet-stream',
      content_base64: b64,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Upload (${resp.status}): ${txt.slice(0, 200)}`);
  }
  return await resp.json();
}

export async function downloadFromOneDrive(path: string): Promise<Blob> {
  const url = `/api/download?path=${encodeURIComponent(path)}`;
  const resp = await fetch(url, { headers: await authHeader() });
  if (!resp.ok) throw new Error(`Download fehlgeschlagen (${resp.status})`);
  return await resp.blob();
}

/** Lädt eine Datei aus OneDrive und triggert einen Browser-Download mit Wunsch-Filename. */
export async function triggerOneDriveDownload(path: string, filename: string): Promise<boolean> {
  try {
    const blob = await downloadFromOneDrive(path);
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
 * Liefert eine Object-URL für die Datei aus OneDrive — geeignet für <img src>.
 * Achtung: muss vom Aufrufer mit URL.revokeObjectURL freigegeben werden.
 */
export async function getOneDriveObjectUrl(path: string): Promise<string | null> {
  try {
    const blob = await downloadFromOneDrive(path);
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('getOneDriveObjectUrl', err);
    return null;
  }
}

export async function sendEmail(args: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments: Array<{ name: string; contentType: string; onedrive_path: string }>;
}): Promise<void> {
  const resp = await fetch('/api/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Email-Versand fehlgeschlagen (${resp.status}): ${txt.slice(0, 200)}`);
  }
}
