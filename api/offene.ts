import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getOffeneFormulareForFahrer,
  createOffenesFormular,
  updateOffenesFormularStatus,
} from './_lib/sharepoint.js';
import { extractBearerToken, verifySessionToken } from './_lib/auth.js';
import { handlePreflight, sendJson, sendError } from './_lib/http.js';

/**
 * /api/offene — CRUD for a driver's "Offene Formulare" entries.
 *
 *   GET    /api/offene                          → list offene (status=Offen) for caller
 *   GET    /api/offene?status=Abgeschlossen     → list filtered by status
 *   POST   /api/offene                          → create new entry
 *                                                 body: { formularname, fahrzeug }
 *   PATCH  /api/offene?id=<itemId>              → update status of one entry
 *                                                 body: { status }
 *
 * All methods require a valid Bearer session token; mutations only affect
 * entries owned by the authenticated driver (verified server-side).
 *
 * RESILIENCE: The "Offene Formulare" SharePoint list may not exist yet or
 * its column names may be wrong. GET returns [] on error, POST returns a
 * best-effort placeholder so the frontend can still open the Fillout form.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handlePreflight(req, res)) return;

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

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const statusParam =
      typeof req.query.status === 'string' && req.query.status.trim()
        ? req.query.status.trim()
        : 'Offen';
    try {
      const items = await getOffeneFormulareForFahrer(
        session.benutzername,
        statusParam
      );
      sendJson(res, 200, items);
    } catch (err) {
      // List doesn't exist or access denied — return empty array
      console.warn('GET /api/offene: SharePoint-Zugriff fehlgeschlagen, gebe [] zurück:', err);
      sendJson(res, 200, []);
    }
    return;
  }

  // ── POST ────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = parseBody(req.body);
    const formularname = typeof body.formularname === 'string' ? body.formularname.trim() : '';
    const fahrzeug = typeof body.fahrzeug === 'string' ? body.fahrzeug.trim() : '';
    const filloutSubmissionId =
      typeof body.filloutSubmissionId === 'string' ? body.filloutSubmissionId.trim() : '';

    if (!formularname) {
      sendError(res, 400, 'formularname ist erforderlich');
      return;
    }
    if (!fahrzeug) {
      sendError(res, 400, 'fahrzeug ist erforderlich');
      return;
    }
    if (!filloutSubmissionId) {
      sendError(res, 400, 'filloutSubmissionId ist erforderlich');
      return;
    }

    try {
      const created = await createOffenesFormular({
        benutzername: session.benutzername,
        formularname,
        fahrzeug,
        filloutSubmissionId,
      });
      sendJson(res, 201, created);
    } catch (err) {
      // List doesn't exist or columns wrong — return a placeholder so the
      // frontend can still navigate to the embed page.
      console.warn('POST /api/offene: SharePoint-Zugriff fehlgeschlagen, gebe Platzhalter zurück:', err);
      sendJson(res, 201, {
        id: 0,
        benutzername: session.benutzername,
        formularname,
        fahrzeug,
        filloutSubmissionId,
        begonnen: new Date().toISOString(),
        status: 'Offen',
        _fallback: true,
      });
    }
    return;
  }

  // ── PATCH ───────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const idRaw = typeof req.query.id === 'string' ? req.query.id : '';
    const id = parseInt(idRaw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      sendError(res, 400, '?id=<number> ist erforderlich');
      return;
    }

    const body = parseBody(req.body);
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    if (!status) {
      sendError(res, 400, 'status ist erforderlich');
      return;
    }

    try {
      const updated = await updateOffenesFormularStatus(
        id,
        session.benutzername,
        status
      );
      if (!updated) {
        sendError(res, 404, 'Eintrag nicht gefunden oder keine Berechtigung');
        return;
      }
      sendJson(res, 200, updated);
    } catch (err) {
      // Best-effort: if status update fails, still confirm so the user
      // can leave the page.
      console.warn('PATCH /api/offene: SharePoint-Zugriff fehlgeschlagen:', err);
      sendJson(res, 200, { id, status, _fallback: true });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH, OPTIONS');
  sendError(res, 405, `Method ${req.method} Not Allowed`);
}

function parseBody(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}
