// Abfragen in Blöcken laden — ohne die stille 1000-Zeilen-Grenze.
//
// PostgREST (Supabase) liefert pro Abfrage höchstens `max-rows` Zeilen
// (Standard 1000) und schneidet den Rest kommentarlos ab. Überall, wo
// mehr Zeilen möglich sind (Tourenliste über einen Zeitraum, Excel-
// Export, Aufstellung, Rechnungen …), lädt dieser Helfer Block für Block
// nach, bis nichts mehr kommt.
//
// Wichtig für Aufrufer:
//   * `abfrage` muss bei jedem Aufruf eine NEUE Abfrage bauen (ein
//     Supabase-Query-Builder lässt sich nur einmal ausführen).
//   * Die Sortierung muss eindeutig sein (z.B. zusätzlich `.order('id')`),
//     sonst können Zeilen an Blockgrenzen doppelt kommen oder fehlen.

export interface BlockErgebnis<T> { data: T[]; error: string | null; bloecke: number }

type Antwort<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function ladeInBloecken<T>(
  abfrage: (von: number, bis: number) => Antwort<T>,
  blockGroesse = 1000,
  maxBloecke = 200,
): Promise<BlockErgebnis<T>> {
  const alle: T[] = [];
  let von = 0;
  // Liefert der Server weniger als angefragt, obwohl es mehr gibt (eine
  // kleinere max-rows-Einstellung), wird die Blockgröße angepasst — sonst
  // hielte man den ersten, gekappten Block fälschlich für den letzten.
  let groesse = blockGroesse;
  for (let i = 0; i < maxBloecke; i += 1) {
    const { data, error } = await abfrage(von, von + groesse - 1);
    if (error) return { data: alle, error: error.message, bloecke: i + 1 };
    const zeilen = data ?? [];
    if (i === 0 && zeilen.length > 0 && zeilen.length < groesse) groesse = zeilen.length;
    alle.push(...zeilen);
    if (zeilen.length === 0 || zeilen.length < groesse) return { data: alle, error: null, bloecke: i + 1 };
    von += zeilen.length;
  }
  return { data: alle, error: `Abbruch nach ${maxBloecke} Blöcken (${alle.length} Zeilen)`, bloecke: maxBloecke };
}

/** `.in()`-Listen aufteilen — lange ID-Listen sprengen sonst die URL-Länge. */
export function inStuecken<T>(liste: T[], groesse = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < liste.length; i += groesse) out.push(liste.slice(i, i + groesse));
  return out;
}

/** Datumsfilter auf das effektive Datum einer Tour (Enddatum, sonst Startdatum) — für `.or()`. */
export function effektivesDatumFilter(von: string, bis: string): string {
  return `and(enddatum.gte.${von},enddatum.lte.${bis}),and(enddatum.is.null,startdatum.gte.${von},startdatum.lte.${bis})`;
}
