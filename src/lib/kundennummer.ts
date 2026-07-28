// Hilfsfunktionen rund um die Kundennummer der Auftraggeber.

/** Numerischer Anteil einer Kundennummer ("K-0042" → 42). null wenn keiner. */
export function kundennummerZahl(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /(\d+)\s*$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nächste freie Kundennummer = höchste vorhandene + 1, im FORMAT des
 * Bestands: Präfix und Stellenzahl (führende Nullen) der höchsten
 * Nummer werden übernommen. Ohne Bestand: "1000" als Startwert.
 */
export function naechsteKundennummer(
  rows: Array<{ kundennummer?: string | null }>,
): string {
  let bestN = -1;
  let bestRaw = '';
  for (const r of rows) {
    const n = kundennummerZahl(r.kundennummer);
    if (n != null && n > bestN) { bestN = n; bestRaw = (r.kundennummer ?? '').trim(); }
  }
  if (bestN < 0) return '1000';
  const m = /^(.*?)(\d+)\s*$/.exec(bestRaw);
  const praefix = m?.[1] ?? '';
  const ziffern = m?.[2] ?? String(bestN);
  const next = String(bestN + 1);
  // Stellenzahl beibehalten, solange sie nicht überschritten wird.
  const gepolstert = next.length < ziffern.length
    ? next.padStart(ziffern.length, '0')
    : next;
  return `${praefix}${gepolstert}`;
}
