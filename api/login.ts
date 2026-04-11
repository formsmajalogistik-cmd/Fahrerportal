import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findFahrerByBenutzername } from './_lib/sharepoint.js';
import { signSessionToken, comparePin } from './_lib/auth.js';
import { handlePreflight, sendJson, sendError } from './_lib/http.js';

/**
 * POST /api/login
 * Body: { benutzername: string, pin: string }
 * Returns: { token: string, user: { id, benutzername, name, vorname } }
 *
 * Authenticates a driver against the Fahrer SharePoint list.
 * On success returns a signed JWT used as Bearer token for subsequent
 * protected API calls.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Always answer preflight FIRST so the browser can send the actual request
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendError(res, 405, `Method ${req.method} Not Allowed`);
    return;
  }

  // Vercel auto-parses JSON bodies when Content-Type is application/json,
  // but we also accept a raw string body just in case.
  let body: { benutzername?: string; pin?: string } = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body);
    } catch {
      sendError(res, 400, 'Ungültiger JSON-Body');
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as { benutzername?: string; pin?: string };
  }

  const benutzername = body.benutzername?.trim();
  const pin = body.pin?.trim();

  if (!benutzername || !pin) {
    sendError(res, 400, 'Benutzername und PIN erforderlich');
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    sendError(res, 400, 'PIN muss 4 Ziffern lang sein');
    return;
  }

  try {
    const fahrer = await findFahrerByBenutzername(benutzername);

    // Generic error to avoid leaking whether the username exists
    if (!fahrer || !comparePin(fahrer.pin, pin)) {
      sendError(res, 401, 'Benutzername oder PIN falsch');
      return;
    }

    const token = signSessionToken({
      sub: fahrer.id,
      benutzername: fahrer.benutzername,
      name: fahrer.name,
      vorname: fahrer.vorname,
    });

    sendJson(res, 200, {
      token,
      user: {
        id: fahrer.id,
        benutzername: fahrer.benutzername,
        name: fahrer.name,
        vorname: fahrer.vorname,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    sendError(res, 500, 'Interner Serverfehler bei der Anmeldung');
  }
}
