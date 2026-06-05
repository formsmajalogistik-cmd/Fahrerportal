// Sehr einfacher In-Memory-TTL-Cache für lesende Supabase-Queries, die
// bei jedem Reiter-Wechsel ein-und-derselben Session immer wieder
// dieselbe Antwort liefern (Auftraggeber-Stammdaten, Fahrer-Liste,
// Preisstufen, etc.).
//
// Default-TTL: 30 Sekunden. Aufrufer können bei mutierenden Aktionen
// (z.B. Auftraggeber bearbeitet) den Cache-Key invalidieren.
//
// Bewusst KEIN globaler Store / React-Query — wir halten den Footprint
// klein. Nicht jede Query passt in den Cache: alles, was den
// Notification-Badge (Eingänge) oder die aktuell offene Detail-Zeile
// betrifft, wird NICHT gecached.

interface Entry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export const DEFAULT_TTL_MS = 30_000;

/**
 * Führt queryFn aus, wenn kein gültiger Cache-Eintrag vorliegt. Bei
 * Erfolg wird das Ergebnis bis maxAgeMs cachet. Bei Fehler wird der
 * Cache NICHT geschrieben — der nächste Call versucht es frisch.
 */
export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  maxAgeMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }
  const data = await queryFn();
  store.set(key, { data, expiresAt: now + maxAgeMs });
  return data;
}

/** Invalidiert einen einzelnen Cache-Eintrag. */
export function invalidateCache(key: string): void {
  store.delete(key);
}

/** Invalidiert alle Einträge, deren Key mit dem Prefix beginnt. */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Leert den gesamten Cache (z.B. beim Logout). */
export function clearCache(): void {
  store.clear();
}
