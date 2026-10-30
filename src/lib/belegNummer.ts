// Rechnungs-/Gutschriftsnummern richtig sortieren.
//
// Als Text sortiert stünde „Re_26/1000" hinter „Re_26/999" ("1" < "9").
// Verglichen wird deshalb „natürlich": Ziffernfolgen als Zahl. Das Format
// der Nummern bleibt unverändert (keine führenden Nullen). Gegenstück in
// der Datenbank: beleg_nr_lauf / next_rechnungsnummer (Migration 110).

const COLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Laufende Zahl am Ende der Nummer („Re_26/1000" → 1000), sonst null. */
export function belegLaufnummer(nr: string | null | undefined): number | null {
  const m = /(\d+)\s*$/.exec(nr ?? '');
  return m ? Number(m[1]) : null;
}

/** Aufsteigender Vergleich zweier Nummern (Re_26/999 < Re_26/1000). */
export function vergleicheBelegNummer(a: string | null | undefined, b: string | null | undefined): number {
  return COLLATOR.compare((a ?? '').trim(), (b ?? '').trim());
}

/**
 * Übersichts-Reihenfolge: Datum absteigend, am selben Tag die höhere
 * Nummer zuerst (Re_26/1000 vor Re_26/999), zuletzt nach Anlage.
 */
export function neuesteBelegeZuerst<T>(
  rows: T[],
  nummer: (r: T) => string | null | undefined,
  datum: (r: T) => string | null | undefined,
  angelegt?: (r: T) => string | null | undefined,
): T[] {
  return [...rows].sort((x, y) => {
    const d = (datum(y) ?? '').localeCompare(datum(x) ?? '');
    if (d !== 0) return d;
    const n = vergleicheBelegNummer(nummer(y), nummer(x));
    if (n !== 0) return n;
    return angelegt ? (angelegt(y) ?? '').localeCompare(angelegt(x) ?? '') : 0;
  });
}
