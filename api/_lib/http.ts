import type { VercelResponse } from '@vercel/node';

/**
 * Apply standard CORS headers to a Vercel response.
 * Since the API and the frontend are served from the same Vercel project,
 * this is mostly precautionary (for local dev across ports or embeds).
 *
 * Browsers send a CORS preflight (OPTIONS) before the actual request when
 * the request includes a non-simple header like `Content-Type: application/json`.
 * The preflight response must include Allow-Methods/Allow-Headers, otherwise
 * the browser cancels the actual request.
 */
export function applyCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

/**
 * Handle a CORS preflight (OPTIONS) request.
 * Returns true if the request was a preflight and has been answered;
 * the caller should then return early.
 */
export function handlePreflight(
  req: { method?: string },
  res: VercelResponse
): boolean {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  applyCors(res);
  res.status(status).json(body);
}

export function sendError(res: VercelResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}
