import type { VercelResponse } from '@vercel/node';

/**
 * Apply standard CORS headers to a Vercel response.
 * Since the API and the frontend are served from the same Vercel project,
 * this is mostly precautionary (for local dev across ports or embeds).
 */
export function applyCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  applyCors(res);
  res.status(status).json(body);
}

export function sendError(res: VercelResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}
