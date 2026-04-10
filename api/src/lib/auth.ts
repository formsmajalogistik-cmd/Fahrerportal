import jwt from 'jsonwebtoken';
import { config } from './config.js';

/**
 * JWT payload representing an authenticated driver session.
 * Issued by /api/login, verified by other endpoints.
 */
export interface SessionToken {
  sub: number;          // Fahrer list item ID
  benutzername: string;
  name: string;
  vorname: string;
}

/** Create a signed JWT for the given driver */
export function signSessionToken(payload: SessionToken): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiry as jwt.SignOptions['expiresIn'],
  });
}

/** Verify a Bearer token and return the decoded session, or null if invalid */
export function verifySessionToken(token: string): SessionToken | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & SessionToken;
    return {
      sub: decoded.sub as unknown as number,
      benutzername: decoded.benutzername,
      name: decoded.name,
      vorname: decoded.vorname,
    };
  } catch {
    return null;
  }
}

/** Extract Bearer token from an Authorization header */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Constant-time PIN comparison to prevent timing attacks.
 *
 * NOTE: In a real deployment, PINs should be hashed (bcrypt/argon2) and
 * never stored in plain text in SharePoint. For this prototype we compare
 * the plain PIN from SharePoint to the one supplied by the user.
 */
export function comparePin(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
