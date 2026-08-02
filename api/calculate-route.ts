// POST /api/calculate-route  { origin: string, destination: string }
//
// Berechnet Routen-Vorschläge zwischen zwei Adressen via Google Routes API.
// API-Key bleibt server-seitig in GOOGLE_MAPS_API_KEY; das Frontend
// schickt nur die Adressen. Vor jedem echten API-Call prüfen wir den
// routen_cache (origin_norm + destination_norm unique, Eintrag < 30 Tage
// alt), um wiederholte Calls für stehende Strecken zu sparen.

import { createClient } from '@supabase/supabase-js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: unknown) => void;
}

interface CalculatedRoute {
  index: number;
  distanceKm: number;
  durationMinutes: number;
  description: string;
  label: string | null;
}

interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  routeLabels?: string[];
}

const CACHE_TTL_DAYS = 30;

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Normalisiert eine Adresse für den Cache-Key — lower-case, getrimmt,
 * Mehrfach-Spaces gemerged. Ziel: "Heiligenroder Strasse 38e, 28816
 * Stuhr " und "heiligenroder strasse 38e,  28816 stuhr" treffen denselben
 * Cache-Eintrag.
 */
function normalizeAddress(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function durationSecondsToMinutes(s: string | undefined): number {
  if (!s) return 0;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(s);
  if (!match) return 0;
  return Math.round(parseFloat(match[1]) / 60);
}

function userClient(token: string) {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const auth = asString(req.headers?.authorization as string | undefined);
    const user = await getAuthedUser(auth);
    const token = (auth ?? '').replace(/^bearer\s+/i, '');
    // Admins und Auftraggeber dürfen rechnen — Auftraggeber pflegen
    // seit Migration 081 die km ihrer eigenen Touren selbst. Der
    // Google-Key bleibt serverseitig und der Endpoint authentifiziert;
    // Fahrer und Test-Profile bleiben ausgeschlossen.
    if (user.role !== 'admin' && user.role !== 'auftraggeber') {
      throw new HttpError(403, 'Keine Berechtigung für die Routenberechnung');
    }

    const body = (req.body && typeof req.body === 'object')
      ? req.body as Record<string, unknown>
      : {};
    const origin = asString(body.origin)?.trim();
    const destination = asString(body.destination)?.trim();
    if (!origin || !destination) {
      throw new HttpError(400, 'origin und destination sind Pflicht');
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new HttpError(500, 'GOOGLE_MAPS_API_KEY fehlt in der Server-Config');
    }

    const supa = userClient(token);
    const originNorm = normalizeAddress(origin);
    const destinationNorm = normalizeAddress(destination);

    // 1) Cache-Hit?
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400_000).toISOString();
    const { data: cached } = await supa
      .from('routen_cache')
      .select('routes, created_at')
      .eq('origin_norm', originNorm)
      .eq('destination_norm', destinationNorm)
      .gte('created_at', cacheCutoff)
      .maybeSingle();
    if (cached?.routes) {
      res.status(200).json({ routes: cached.routes, cached: true });
      return;
    }

    // 2) Google Routes API
    const gResp = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.description,routes.routeLabels',
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: 'DRIVE',
          computeAlternativeRoutes: true,
          languageCode: 'de',
          regionCode: 'DE',
        }),
      },
    );
    const gData = await gResp.json().catch(() => ({} as Record<string, unknown>));
    if (!gResp.ok) {
      const msg = (gData as { error?: { message?: string } }).error?.message
        ?? `Google-API-Fehler (${gResp.status})`;
      // 400 von Google bei unbekannter Adresse → 422 ans Frontend, damit
      // der dortige Fehlerpfad "Adresse nicht gefunden" zeigen kann.
      const fwdStatus = gResp.status === 400 ? 422 : 502;
      throw new HttpError(fwdStatus, msg);
    }

    const rawRoutes: GoogleRoute[] = Array.isArray((gData as { routes?: GoogleRoute[] }).routes)
      ? (gData as { routes: GoogleRoute[] }).routes
      : [];
    if (rawRoutes.length === 0) {
      throw new HttpError(422, 'Keine Route gefunden — bitte Adressen prüfen.');
    }
    const routes: CalculatedRoute[] = rawRoutes.map((r, i) => ({
      index: i,
      distanceKm: Math.round((r.distanceMeters ?? 0) / 1000),
      durationMinutes: durationSecondsToMinutes(r.duration),
      description: r.description?.trim() || `Route ${i + 1}`,
      label: r.routeLabels?.[0] ?? null,
    }));
    // Sortierung: kürzeste Distanz zuerst.
    routes.sort((a, b) => a.distanceKm - b.distanceKm);
    // Original-Indizes neu vergeben, damit Label-Auswahl im Frontend
    // konsistent ist.
    routes.forEach((r, i) => { r.index = i; });

    // 3) Cache schreiben — Fehler dabei nicht durchreichen, Cache ist
    //    nur Optimierung.
    try {
      await supa
        .from('routen_cache')
        .upsert(
          {
            origin_norm: originNorm,
            destination_norm: destinationNorm,
            routes: routes as unknown as Record<string, unknown>,
          },
          { onConflict: 'origin_norm,destination_norm' },
        );
    } catch (cacheErr) {
      console.warn('[/api/calculate-route] Cache-Write fehlgeschlagen', cacheErr);
    }

    res.status(200).json({ routes, cached: false });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    console.error('[/api/calculate-route]', err);
    res.status(status).json({ error: msg });
  }
}
