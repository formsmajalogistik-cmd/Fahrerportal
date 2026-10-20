// Welcher Formularstand gilt — Server oder Gerät?
//
// Fall Emre Günes (Oktober 2026): Die Formularwerte lagen nur im lokalen
// Speicher (IndexedDB). iOS leerte den Speicher der Website, beim Öffnen
// gab es nur den Server-Stand vom Anlegen → leeres Protokoll. Jetzt wird
// laufend auch zum Server gespeichert (lib/entwurfSync), und beim Öffnen
// entscheidet diese Regel. Grundsatz: ein leerer oder deutlich kleinerer
// Stand überschreibt NIE einen volleren; echte Konflikte entscheidet der
// Fahrer.
//
// Bewusst ohne IDB/Supabase, damit die Regel für sich prüfbar ist.

/** Ausgefüllte Felder — gleiche Zählung wie formular_felder_anzahl() in SQL. */
export function felderAnzahl(daten: Record<string, unknown> | null | undefined): number {
  if (!daten) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(daten)) {
    if (k.startsWith('_')) continue;
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    n += 1;
  }
  return n;
}

/** Schlüsselreihenfolge-unabhängiger Vergleich. */
export function gleicherInhalt(a: unknown, b: unknown): boolean {
  return stabil(a) === stabil(b);
}
function stabil(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabil).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stabil((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export interface ServerStand {
  daten: Record<string, unknown>;
  /** daten_geaendert_am (Migration 107); null bei älterem Server. */
  geaendertAm: string | null;
}
export interface LokalerStand {
  daten: Record<string, unknown>;
  /** ms epoch der letzten lokalen Speicherung. */
  savedAt: number;
  /** daten_geaendert_am nach dem letzten Server-Save von diesem Gerät. */
  serverStand?: string | null;
}

export type Entscheidung =
  | { quelle: 'server' | 'lokal' | 'gleich'; grund: string }
  | { quelle: 'konflikt'; grund: string };

/** „Deutlich kleiner": weniger als die Hälfte der Felder des anderen. */
function deutlichKleiner(a: number, b: number): boolean {
  return a < b * 0.5;
}

export function entwurfWaehlen(server: ServerStand, lokal: LokalerStand | null): Entscheidung {
  if (!lokal) return { quelle: 'server', grund: 'kein_lokaler_stand' };
  if (gleicherInhalt(server.daten, lokal.daten)) return { quelle: 'gleich', grund: 'identisch' };
  const nS = felderAnzahl(server.daten);
  const nL = felderAnzahl(lokal.daten);
  if (nL === 0) return { quelle: 'server', grund: 'lokal_leer' };
  if (nS === 0) return { quelle: 'lokal', grund: 'server_leer' };
  // Seit dem letzten Server-Save dieses Geräts hat niemand sonst
  // geschrieben → die lokalen Änderungen sind die neueren. Aber auch dann
  // überschreibt ein deutlich kleinerer Stand keinen volleren.
  if (lokal.serverStand && server.geaendertAm && lokal.serverStand === server.geaendertAm) {
    if (deutlichKleiner(nL, nS)) return { quelle: 'konflikt', grund: 'lokal_neuer_aber_deutlich_kleiner' };
    return { quelle: 'lokal', grund: 'lokal_neuer_server_unveraendert' };
  }
  if (deutlichKleiner(nL, nS)) return { quelle: 'server', grund: 'lokal_deutlich_kleiner' };
  if (deutlichKleiner(nS, nL)) return { quelle: 'lokal', grund: 'server_deutlich_kleiner' };
  const tS = server.geaendertAm ? Date.parse(server.geaendertAm) : NaN;
  // Jünger UND mindestens so voll → eindeutig.
  if (Number.isFinite(tS)) {
    if (lokal.savedAt > tS && nL >= nS) return { quelle: 'lokal', grund: 'lokal_juenger_und_voller' };
    if (tS > lokal.savedAt && nS >= nL) return { quelle: 'server', grund: 'server_juenger_und_voller' };
  } else if (nL >= nS) {
    return { quelle: 'lokal', grund: 'server_ohne_datum' };
  }
  return { quelle: 'konflikt', grund: 'beide_unterschiedlich' };
}

/** Browser-Tab oder zum Home-Bildschirm hinzugefügte App. */
export function appModus(): 'app' | 'browser' {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return standalone ? 'app' : 'browser';
  } catch {
    return 'browser';
  }
}

/** iPhone/iPad (auch iPadOS, das sich als Mac ausgibt). */
export function istIos(): boolean {
  try {
    const ua = navigator.userAgent ?? '';
    return /iP(hone|ad|od)/.test(ua)
      || (/Macintosh/.test(ua) && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  } catch {
    return false;
  }
}
