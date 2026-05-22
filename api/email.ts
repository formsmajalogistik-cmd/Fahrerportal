// POST /api/email
// Body (JSON):
//   {
//     to: string[], cc?: string[],
//     subject: string, body: string,
//     attachments?: Array<{ name: string; contentType: string; onedrive_path: string }>
//   }
// Lädt jede angegebene Anlage aus OneDrive und versendet die Mail über /sendMail.

import { downloadFile, sendMail } from '../server-lib/graph.js';
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

interface AttachIn { name: string; contentType: string; onedrive_path: string }
interface EmailBody {
  to: string[]; cc?: string[];
  subject: string; body: string;
  attachments?: AttachIn[];
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/**
 * Lädt eine Datei aus OneDrive, retryt bei Fehlern mit exponentiellem
 * Backoff (1 s, 2 s, 4 s). Microsoft Graph braucht nach Uploads — vor
 * allem über Upload-Session-Chunks — gelegentlich ein paar Sekunden
 * Propagation. Gibt null zurück, wenn alle Versuche scheitern.
 */
async function downloadWithRetry(
  path: string, attempts: number,
): Promise<Uint8Array | null> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { bytes } = await downloadFile(path);
      if (i > 0) console.info(`[/api/email] Anhang nach ${i + 1}. Versuch geladen: ${path}`);
      return bytes;
    } catch (err) {
      const isLast = i === attempts - 1;
      console.warn(
        `[/api/email] Anhang Versuch ${i + 1}/${attempts} fehlgeschlagen (${path}):`,
        err instanceof Error ? err.message : err,
      );
      if (isLast) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
  try {
    await getAuthedUser(asString(req.headers?.authorization));
    const b = (req.body ?? {}) as Partial<EmailBody>;

    const to = (b.to ?? []).map((s) => s.trim()).filter(Boolean);
    const cc = (b.cc ?? []).map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) { res.status(400).json({ error: 'Mindestens ein Empfänger nötig' }); return; }
    if (!b.subject) { res.status(400).json({ error: 'Betreff fehlt' }); return; }

    // Anhänge aus OneDrive laden. Microsoft Graph braucht nach einem
    // frischen Upload manchmal ein paar Sekunden, bis die Datei über
    // den Path-Endpoint erreichbar ist — wir retryen 3x mit Backoff.
    // Wenn Dateien danach immer noch fehlen, senden wir die Mail mit
    // den verfügbaren Anhängen UND einer Hinweis-Zeile im Body. Der
    // Client bekommt die Liste der fehlenden Namen zurück und kann
    // eine Warnung anzeigen statt einen Fehler.
    const requested = (b.attachments ?? []).filter(
      (a) => a.onedrive_path && !a.onedrive_path.includes('..'),
    );
    const attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> = [];
    const failed: string[] = [];
    for (const a of requested) {
      const bytes = await downloadWithRetry(a.onedrive_path, 3);
      if (!bytes) {
        failed.push(a.name || a.onedrive_path);
        continue;
      }
      attachments.push({ name: a.name, contentType: a.contentType, bytes });
    }

    let bodyText = b.body ?? '';
    if (failed.length > 0) {
      const note = `\n\n---\nHinweis: ${failed.length} Anhang/Anhänge konnten nicht geladen werden `
        + `(${failed.join(', ')}). Bitte beim Admin nachfragen oder "E-Mail erneut senden" nutzen.`;
      bodyText = `${bodyText}${note}`;
      console.warn(
        `[/api/email] ${failed.length}/${requested.length} Anhänge fehlten nach Retries:`,
        failed,
      );
    }

    console.info(
      `[/api/email] sende an=${to.join(',')} cc=${cc.join(',')} attachments=${attachments.length}`
      + (failed.length > 0 ? ` (FEHLT: ${failed.length})` : ''),
    );
    await sendMail({
      to, cc: cc.length > 0 ? cc : undefined,
      subject: b.subject,
      bodyText,
      attachments,
    });

    res.status(200).json({
      ok: true,
      sent_to: to,
      cc,
      attached: attachments.length,
      missing: failed,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/email]', err);
    res.status(status).json({ error: msg });
  }
}
