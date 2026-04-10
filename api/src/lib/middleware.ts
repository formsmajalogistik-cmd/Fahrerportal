import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { extractBearerToken, verifySessionToken, SessionToken } from './auth.js';
import { errorResponse } from './http.js';

/**
 * Verify the Bearer token on an incoming request.
 * Returns either the decoded session (on success) or an HTTP error response.
 */
export function requireAuth(
  request: HttpRequest
): { session: SessionToken } | { response: HttpResponseInit } {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) {
    return { response: errorResponse(401, 'Authorization-Header fehlt') };
  }

  const session = verifySessionToken(token);
  if (!session) {
    return { response: errorResponse(401, 'Ungültiger oder abgelaufener Token') };
  }

  return { session };
}
