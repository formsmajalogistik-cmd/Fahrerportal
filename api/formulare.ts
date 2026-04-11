import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFormulareForFahrer } from './_lib/sharepoint.js';
import { extractBearerToken, verifySessionToken } from './_lib/auth.js';
import { handlePreflight, sendJson, sendError } from './_lib/http.js';

/**
 * GET /api/formulare
 * Header: Authorization: Bearer <token>
 *
 * Returns active forms assigned to the authenticated driver by joining
 * Fahrerzuweisung (filtered by Benutzername) with Formulare (filtered by
 * matching Formularname and Aktiv=true).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handlePreflight(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    sendError(res, 405, `Method ${req.method} Not Allowed`);
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Authorization-Header fehlt');
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    sendError(res, 401, 'Ungültiger oder abgelaufener Token');
    return;
  }

  try {
    const items = await getFormulareForFahrer(session.benutzername);
    sendJson(res, 200, items);
  } catch (err) {
    console.error('Formulare error:', err);
    sendError(res, 500, 'Fehler beim Laden der Formulare');
  }
}
