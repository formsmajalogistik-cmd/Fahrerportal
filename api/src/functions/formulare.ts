import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getFormulareForFahrer } from '../lib/sharepoint.js';
import { requireAuth } from '../lib/middleware.js';
import { jsonResponse, errorResponse, corsPreflight } from '../lib/http.js';

/**
 * GET /api/formulare
 * Header: Authorization: Bearer <token>
 *
 * Returns all forms assigned to the currently authenticated driver by
 * joining Formulare and FahrerFormulare based on the driver ID in the
 * session token.
 */
export async function formulare(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return corsPreflight();

  const auth = requireAuth(request);
  if ('response' in auth) return auth.response;

  try {
    const items = await getFormulareForFahrer(auth.session.sub);
    return jsonResponse(200, items);
  } catch (err) {
    context.error('Formulare error:', err);
    return errorResponse(500, 'Fehler beim Laden der Formulare');
  }
}

app.http('formulare', {
  route: 'formulare',
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: formulare,
});
