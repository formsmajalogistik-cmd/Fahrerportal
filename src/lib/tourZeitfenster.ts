// Zeitfenster für Tour-Auswahllisten.
//
// Erst genutzt von der Tour-Auswahl für „Zusätze hinzufügen" / „Zusätze +
// Belege" im Posteingang: Zusätze und Belege kommen Tage NACH der Fahrt,
// die Liste soll deshalb die letzten Tage zeigen — und nicht von
// geplanten Zukunftstouren verstopft werden.
//
// Bewusst ohne Supabase-Import, damit die Regeln für sich prüfbar sind.

/** Tage zurück / voraus, bezogen auf heute. */
export interface Zeitfenster {
  tageZurueck: number;
  tageVoraus: number;
}

/** Standard für Zusätze und Belege: 7 Tage zurück, 2 Tage voraus. */
export const ZUSAETZE_ZEITFENSTER: Zeitfenster = { tageZurueck: 7, tageVoraus: 2 };

const pad = (n: number) => String(n).padStart(2, '0');

/** Lokales Kalenderdatum als "YYYY-MM-DD" (nicht UTC — sonst kippt es nachts). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function zeitfensterGrenzen(heute: Date, f: Zeitfenster): { von: string; bis: string } {
  const von = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - f.tageZurueck);
  const bis = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + f.tageVoraus);
  return { von: ymd(von), bis: ymd(bis) };
}

/**
 * PostgREST-`or`-Filter: Eine Tour gehört ins Fenster, wenn sich ihr
 * Zeitraum mit dem Fenster ÜBERSCHNEIDET — so zählt auch eine mehrtägige
 * Tour, die vor dem Fenster begann und darin endet.
 *
 *   * regulär:          enddatum >= von  UND  startdatum <= bis
 *   * ohne Enddatum:    Startdatum gilt als Enddatum
 *   * ohne Startdatum:  Enddatum gilt als Startdatum
 *   * auf Eis:          immer (sonst wären sie hier nie auffindbar)
 *
 * Gleichbedeutend mit `liegtImZeitfenster()` — die Funktion daneben ist
 * die prüfbare Fassung derselben Regel.
 */
export function zeitfensterOrFilter(von: string, bis: string): string {
  return [
    'auf_eis.is.true',
    `and(enddatum.gte.${von},startdatum.lte.${bis})`,
    `and(enddatum.is.null,startdatum.gte.${von},startdatum.lte.${bis})`,
    `and(startdatum.is.null,enddatum.gte.${von},enddatum.lte.${bis})`,
  ].join(',');
}

export interface ZeitTour {
  startdatum: string | null;
  enddatum: string | null;
  auf_eis?: boolean | null;
}

/** Effektiver Zeitraum: fehlt eine Grenze, gilt die andere. */
function zeitraum(t: ZeitTour): { start: string; ende: string } | null {
  const start = t.startdatum?.slice(0, 10) || t.enddatum?.slice(0, 10) || null;
  const ende = t.enddatum?.slice(0, 10) || t.startdatum?.slice(0, 10) || null;
  return start && ende ? { start, ende } : null;
}

export function liegtImZeitfenster(t: ZeitTour, von: string, bis: string): boolean {
  if (t.auf_eis) return true;
  const z = zeitraum(t);
  return !!z && z.ende >= von && z.start <= bis;
}

function tageZwischen(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Sortierung „nächstliegende zuerst":
 *   1. läuft heute,
 *   2. dann nach Abstand zu heute — vergangene ab dem Enddatum, künftige
 *      ab dem Startdatum. Bei gleichem Abstand die vergangene zuerst (für
 *      Zusätze ist gestern wahrscheinlicher als morgen).
 *   3. Touren auf Eis bzw. ganz ohne Datum ans Ende.
 * Vergangene stehen dadurch absteigend nach Datum: gestern vor vorgestern.
 */
export function naechstliegendZuerst<T extends ZeitTour>(touren: T[], heute: Date): T[] {
  const h = ymd(heute);
  const schluessel = (t: T): [number, number, number] => {
    const z = zeitraum(t);
    if (t.auf_eis || !z) return [2, 0, 0];
    if (z.start <= h && z.ende >= h) return [0, 0, 0];
    if (z.ende < h) return [1, tageZwischen(z.ende, h), 0];
    return [1, tageZwischen(h, z.start), 1];
  };
  // Gleicher Abstand (z.B. zwei Touren, die beide vorgestern endeten):
  // die später begonnene zuerst — sonst hinge die Reihenfolge davon ab,
  // wie die Datenbank die Zeilen liefert.
  const beginn = (t: T) => zeitraum(t)?.start ?? '';
  return touren
    .map((t, i) => ({ t, k: schluessel(t), b: beginn(t), i }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]
      || b.b.localeCompare(a.b) || a.i - b.i)
    .map((x) => x.t);
}
