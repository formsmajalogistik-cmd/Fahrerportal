import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findFahrerByBenutzername } from './_lib/sharepoint.js';
import { signSessionToken, comparePin } from './_lib/auth.js';
import { applyCors, sendJson, sendError } from './_lib/http.js';

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
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  // Vercel auto-parses JSON bodies when Content-Type is application/json
  const body = (req.body || {}) as { benutzername?: string; pin?: string };
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
