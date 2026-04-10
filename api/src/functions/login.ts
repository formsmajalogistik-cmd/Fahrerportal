import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { findFahrerByBenutzername } from '../lib/sharepoint.js';
import { signSessionToken, comparePin } from '../lib/auth.js';
import { jsonResponse, errorResponse, corsPreflight } from '../lib/http.js';

/**
 * POST /api/login
 * Body: { benutzername: string, pin: string }
 * Returns: { token: string, user: { id, benutzername, name, vorname } }
 *
 * Authenticates a driver against the Fahrer SharePoint list.
 * On success returns a signed JWT to be used as Bearer token for
 * subsequent /api/formulare and /api/offene calls.
 */
export async function login(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return corsPreflight();

  let body: { benutzername?: string; pin?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(400, 'Ungültiger Request-Body');
  }

  const benutzername = body.benutzername?.trim();
  const pin = body.pin?.trim();

  if (!benutzername || !pin) {
    return errorResponse(400, 'Benutzername und PIN erforderlich');
  }

  if (!/^\d{4}$/.test(pin)) {
    return errorResponse(400, 'PIN muss 4 Ziffern lang sein');
  }

  try {
    const fahrer = await findFahrerByBenutzername(benutzername);

    if (!fahrer || !comparePin(fahrer.pin, pin)) {
      // Generic message to avoid leaking whether username exists
      return errorResponse(401, 'Benutzername oder PIN falsch');
    }

    const token = signSessionToken({
      sub: fahrer.id,
      benutzername: fahrer.benutzername,
      name: fahrer.name,
      vorname: fahrer.vorname,
    });

    return jsonResponse(200, {
      token,
      user: {
        id: fahrer.id,
        benutzername: fahrer.benutzername,
        name: fahrer.name,
        vorname: fahrer.vorname,
      },
    });
  } catch (err) {
    context.error('Login error:', err);
    return errorResponse(500, 'Interner Serverfehler bei der Anmeldung');
  }
}

app.http('login', {
  route: 'login',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: login,
});
