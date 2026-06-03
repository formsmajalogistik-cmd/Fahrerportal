// Client-Helper für die Routen-Berechnung via /api/calculate-route.
// Der API-Key bleibt server-seitig — wir schicken nur die Adressen.
//
// Rückgabe: Liste der Routen-Vorschläge, kürzeste zuerst. Bei jedem
// Fehler wirft die Funktion mit einer für den User lesbaren Message,
// damit der Aufrufer (Tour-Detail-Panel) eine dezente Fehlermeldung
// anzeigen kann ("Routenberechnung fehlgeschlagen — bitte km manuell
// eingeben").

import { getValidToken } from './supabase';
import { fetchWithRetry } from './fetchRetry';

export interface RouteSuggestion {
  index: number;
  distanceKm: number;
  durationMinutes: number;
  description: string;
  label: string | null;
}

export class RouteCalcError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function calculateRoute(args: {
  origin: string;
  destination: string;
}): Promise<RouteSuggestion[]> {
  const origin = args.origin?.trim();
  const destination = args.destination?.trim();
  if (!origin || !destination) {
    throw new RouteCalcError(400, 'Start- und Zieladresse sind erforderlich.');
  }
  const token = await getValidToken();
  if (!token) {
    throw new RouteCalcError(401, 'Sitzung abgelaufen — bitte neu anmelden.');
  }
  let resp: Response;
  try {
    resp = await fetchWithRetry('/api/calculate-route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ origin, destination }),
      // Google kann je nach Strecke 5-8 s brauchen; default 15 s reicht.
      timeoutMs: 20_000,
      // Bei Netz-Hiccups einmal wiederholen.
      retries: 1,
    });
  } catch (err) {
    throw new RouteCalcError(0, err instanceof Error ? err.message : 'Netzwerkfehler');
  }
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json() as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* body kein JSON */ }
    throw new RouteCalcError(resp.status, msg);
  }
  const json = await resp.json() as { routes?: RouteSuggestion[] };
  return Array.isArray(json.routes) ? json.routes : [];
}

/** Formatiert Dauer in Stunden + Minuten ("6 Std. 30 Min." / "45 Min."). */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '—';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}
