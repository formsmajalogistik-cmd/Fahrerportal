// Frontend-Client für die /api-Routen, die das OneDrive über Microsoft Graph
// bedienen. Alle Calls laufen mit dem Supabase-Bearer-Token im Header.

import { supabase, getValidToken } from './supabase';
import { fetchWithRetry } from './fetchRetry';

/**
 * Liefert {Authorization: "Bearer <token>"}-Header. Nutzt getValidToken(),
 * das einen baldigen Ablauf proaktiv via refreshSession() ausgleicht —
 * Safari/PWA-Sessions können sonst still mit einem abgelaufenen Token
 * weiterlaufen und der Server antwortet mit 401 "Token ungültig".
 *
 * Gibt ein leeres Objekt zurück, wenn keine Session mehr existiert.
 * In dem Fall wird `redirectToLogin` getriggert, damit der User nicht
 * mit einem stillen 401-Loop landet.
 */
async function authHeader(): Promise<Record<string, string>> {
  const token = await getValidToken();
  if (!token) {
    redirectToLoginOnce();
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Einmaliger Login-Redirect (Safari-PWA: wenn die Session weg ist,
 * sollen mehrere parallele Calls NICHT mehrmals navigation triggern).
 */
let redirected = false;
function redirectToLoginOnce() {
  if (redirected) return;
  if (typeof window === 'undefined') return;
  // Bereits auf /login? Nichts tun.
  if (window.location.pathname.startsWith('/login')) return;
  redirected = true;
  console.warn('[onedrive] Keine gültige Session — leite zum Login um');
  window.location.href = '/login?reason=session_expired';
}

/**
 * Fetch + automatischer Retry bei 401. Wenn der Server 401 meldet,
 * versuchen wir EINMAL einen frischen Token zu holen (refreshSession)
 * und wiederholen den Call. Schlägt auch der zweite Versuch fehl,
 * geht es in den Login-Redirect.
 */
async function fetchWithAuthRetry(
  url: string,
  init: Parameters<typeof fetchWithRetry>[1] = {},
): Promise<Response> {
  const buildInit = async (): Promise<typeof init> => {
    const auth = await authHeader();
    return {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...auth },
    };
  };
  let resp = await fetchWithRetry(url, await buildInit());
  if (resp.status === 401) {
    console.warn('[onedrive] 401 — versuche Token-Refresh und Retry');
    // refreshSession durch getValidToken-Pfad — danach erneut fetchen.
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      redirectToLoginOnce();
      return resp;
    }
    resp = await fetchWithRetry(url, await buildInit());
    if (resp.status === 401) {
      redirectToLoginOnce();
    }
  }
  return resp;
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
// also alles über ~3 MB binär nicht mehr durch /api/onedrive?action=upload —
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
  const resp = await fetchWithAuthRetry('/api/onedrive?action=upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      console.warn('[uploadToOneDrive] /api/onedrive?action=upload 413 → Session-Fallback');
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
  const sess = await fetchWithAuthRetry('/api/onedrive?action=upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const qs = new URLSearchParams({ action: 'download', path });
  if (opts?.formularId) qs.set('formular_id', opts.formularId);
  const resp = await fetchWithAuthRetry(
    `/api/onedrive?${qs.toString()}`,
    { timeoutMs: 60_000 },
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

/**
 * True, wenn der aktuelle Tab als installierte PWA läuft. In iOS-/macOS-
 * Safari-PWAs ist `window.open()` blockiert, und `<a download>` mit
 * Object-URLs verhält sich unzuverlässig. Aufrufer können das nutzen,
 * um direkt auf den Inline-Modal-Fallback umzuschalten, statt erst auf
 * den Popup-Block zu warten.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* ignore */ }
  // iOS-Safari hat den nicht-standard navigator.standalone-Flag.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/** True für Safari (incl. iOS), false für Chrome/Edge/Firefox. */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
}

/**
 * Triggert einen Datei-Download über eine data-URL (FileReader). In
 * Safari-PWAs ist dieser Weg deutlich zuverlässiger als der klassische
 * URL.createObjectURL-Anchor-Click — und auf Chrome/Edge funktioniert
 * er ebenfalls problemlos.
 */
function downloadBlobViaDataUrl(blob: Blob, filename: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const a = document.createElement('a');
        a.href = String(reader.result ?? '');
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve(true);
      } catch (err) {
        console.warn('[downloadBlobViaDataUrl] anchor-click fehlgeschlagen', err);
        resolve(false);
      }
    };
    reader.onerror = () => {
      console.warn('[downloadBlobViaDataUrl] FileReader-Fehler', reader.error);
      resolve(false);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Letzter Notnagel-Fallback für PWA-Browser, die weder Object-URL- noch
 * data-URL-Downloads zulassen: navigiere direkt zum Proxy-Endpoint
 * mit Token als Query-Parameter — der Server triggert dann selbst die
 * Content-Disposition. Funktioniert immer, weil hier kein JS-Download
 * mehr involviert ist; Nachteil: der Token landet in der History.
 */
async function downloadViaWindowLocation(
  path: string, opts?: { formularId?: string | null },
): Promise<boolean> {
  // Token MUSS frisch sein — sonst landet der Server-Aufruf im 401.
  const token = await getValidToken();
  if (!token) {
    redirectToLoginOnce();
    return false;
  }
  const qs = new URLSearchParams({ action: 'download', path, token });
  if (opts?.formularId) qs.set('formular_id', opts.formularId);
  window.location.href = `/api/onedrive?${qs.toString()}`;
  return true;
}

/** Lädt eine Datei aus OneDrive und triggert einen Browser-Download mit Wunsch-Filename. */
export async function triggerOneDriveDownload(
  path: string, filename: string, opts?: { formularId?: string | null },
): Promise<boolean> {
  try {
    const blob = await downloadFromOneDrive(path, opts);
    // Safari/PWA: bevorzugt data-URL — Object-URL + <a download> verhält
    // sich dort unzuverlässig (Tab öffnet sich, statt zu downloaden).
    if (isSafari() || isStandalonePwa()) {
      const ok = await downloadBlobViaDataUrl(blob, filename);
      if (ok) return true;
      // Wenn auch das fehlschlägt, navigiere via Server-Redirect.
      return await downloadViaWindowLocation(path, opts);
    }
    // Chrome/Edge/Firefox: Object-URL ist schneller (kein FileReader-RT).
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
 * Öffnet die PDF als Vorschau. Strategie:
 *   1. Safari/iOS- oder Mac-PWA (Standalone): direkt das Inline-Modal
 *      öffnen — `window.open()` ist dort entweder gesperrt oder zeigt
 *      Blob-URLs nicht zuverlässig an. Wir senden ein CustomEvent
 *      `maja:pdf-preview`, den `<PdfPreviewProvider />` (einmalig in
 *      AppShell/AdminShell montiert) abfängt und rendert.
 *   2. Sonstige Browser: synchrones `window.open('about:blank')`, dann
 *      nach dem Fetch via `placeholder.location.href = blobUrl`
 *      umlenken — schlägt das fehl, fällt es ebenfalls aufs Modal.
 *
 * `filename` ist optional; wenn nicht gegeben, leitet sich der Anzeige-
 * Name aus dem Dateinamen am Pfad-Ende ab.
 */
export async function previewOneDrivePdf(
  path: string, opts?: { formularId?: string | null; filename?: string },
): Promise<boolean> {
  const filename = opts?.filename || path.split('/').pop() || 'preview.pdf';
  const useModalDirectly = isSafari() || isStandalonePwa();

  // Bei "klassischen" Browsern: Platzhalter-Tab SYNCHRON öffnen (zählt
  // als User-Gesture). Bei Safari/PWA überspringen wir das.
  const placeholder = useModalDirectly ? null : window.open('about:blank', '_blank');

  try {
    const qs = new URLSearchParams({ action: 'download', path, inline: '1' });
    if (opts?.formularId) qs.set('formular_id', opts.formularId);
    const resp = await fetchWithAuthRetry(
      `/api/onedrive?${qs.toString()}`,
      { timeoutMs: 60_000 },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(
        `[onedrive.preview] ${resp.status} ${resp.statusText} path=${path}`
        + (text ? ` body=${text.slice(0, 200)}` : ''),
      );
      placeholder?.close();
      throw new Error(`Vorschau fehlgeschlagen (${resp.status})`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);

    // Safari/PWA → immer Modal.
    if (useModalDirectly) {
      window.dispatchEvent(new CustomEvent('maja:pdf-preview', {
        detail: { blobUrl: url, filename },
      }));
      // Der Provider übernimmt das URL.revokeObjectURL beim Schließen.
      return true;
    }

    if (placeholder && !placeholder.closed) {
      placeholder.location.href = url;
      // Object-URL nach 60 s wieder freigeben.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    }
    // Popup wurde nachträglich geblockt → ebenfalls Modal.
    window.dispatchEvent(new CustomEvent('maja:pdf-preview', {
      detail: { blobUrl: url, filename },
    }));
    return true;
  } catch (err) {
    placeholder?.close();
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
 * Löscht eine Datei aus OneDrive. Nutzt /api/onedrive?action=delete-pdf
 * mit derselben Pro-Resource-Authorisierung wie der Download.
 */
export async function deleteFromOneDrive(path: string, formularId: string): Promise<boolean> {
  try {
    const resp = await fetchWithAuthRetry('/api/onedrive?action=delete-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  /** Plain-Text-Body. Wird ignoriert, wenn bodyHtml gesetzt ist. */
  body: string;
  /** Optional: HTML-Body (inkl. Signatur). Hat Vorrang vor body. */
  bodyHtml?: string;
  /** Optional: Absende-Postfach (UPN). Default: serverseitig hinterlegtes
   *  ONEDRIVE_USER_EMAIL. Muss in der Mailbox-Whitelist stehen. */
  from?: string;
  attachments: Array<{ name: string; contentType: string; onedrive_path: string }>;
}): Promise<SendEmailResult> {
  const resp = await fetchWithAuthRetry('/api/emails?action=eingang-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
