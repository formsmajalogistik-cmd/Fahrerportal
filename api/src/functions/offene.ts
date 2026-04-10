import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getOffeneFormulareForFahrer } from '../lib/sharepoint.js';
import { requireAuth } from '../lib/middleware.js';
import { jsonResponse, errorResponse, corsPreflight } from '../lib/http.js';

/**
 * GET /api/offene
 * Header: Authorization: Bearer <token>
 *
 * Returns pending/open form submissions for the currently authenticated
 * driver from the OffeneFormulare SharePoint list.
 */
export async function offene(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return corsPreflight();

  const auth = requireAuth(request);
  if ('response' in auth) return auth.response;

  try {
    const items = await getOffeneFormulareForFahrer(auth.session.sub);
    return jsonResponse(200, items);
  } catch (err) {
    context.error('Offene formulare error:', err);
    return errorResponse(500, 'Fehler beim Laden der offenen Formulare');
  }
}

app.http('offene', {
  route: 'offene',
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: offene,
});
