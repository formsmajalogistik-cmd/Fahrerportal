// Gründe für eine Leerfahrt — zentrale Liste (Migration 120).
// Neue Gründe einfach hier ergänzen: Der Code (nur a–z und _) wird
// gespeichert, die Bezeichnung erscheint in Dialog, Tooltip und in der
// Zeile der internen Info.

export interface LeerfahrtGrund {
  code: string;
  label: string;
  /** Eigener Text ist Pflicht (statt optionaler Ergänzung). */
  textPflicht?: boolean;
}

export const LEERFAHRT_GRUENDE: readonly LeerfahrtGrund[] = [
  { code: 'nicht_abholbereit', label: 'Fahrzeug nicht abholbereit' },
  { code: 'keine_zulassung', label: 'Fahrzeug hat keine Zulassung' },
  { code: 'ohne_bereifung', label: 'Fahrzeug ohne Bereifung' },
  { code: 'falsche_bereifung', label: 'Fahrzeug mit falscher Bereifung' },
  { code: 'defekt', label: 'Fahrzeug defekt' },
  { code: 'kurzfristiger_storno', label: 'Kurzfristiger Storno' },
  { code: 'sonstiges', label: 'Sonstiges', textPflicht: true },
];

export function leerfahrtGrundLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LEERFAHRT_GRUENDE.find((g) => g.code === code)?.label ?? code;
}

/** Text ohne Zeilenumbrüche (die Zeile in der internen Info ist einzeilig). */
function einzeilig(t: string | null | undefined): string {
  return (t ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * Kurzbeschreibung des Grundes: „Fahrzeug defekt (Bremse blockiert)" bzw.
 * bei Sonstiges nur der eigene Text.
 */
export function leerfahrtGrundText(code: string | null | undefined, text?: string | null): string | null {
  if (!code) return null;
  const g = LEERFAHRT_GRUENDE.find((x) => x.code === code);
  const t = einzeilig(text);
  if (g?.textPflicht) return t || g.label;
  const label = g?.label ?? code;
  return t ? `${label} (${t})` : label;
}

/** Zeile für die interne Info: „Leerfahrt – Fahrzeug defekt (Bremse blockiert)". */
export function leerfahrtZeile(code: string, text?: string | null): string {
  return `Leerfahrt – ${leerfahrtGrundText(code, text) ?? ''}`.trim();
}

/** Prüft die Eingabe im Dialog; liefert eine Meldung oder null. */
export function leerfahrtEingabeFehler(code: string | null, text: string): string | null {
  if (!code) return 'Bitte einen Grund auswählen.';
  const g = LEERFAHRT_GRUENDE.find((x) => x.code === code);
  if (g?.textPflicht && !einzeilig(text)) return `Bei „${g.label}" bitte den Grund eintragen.`;
  return null;
}
