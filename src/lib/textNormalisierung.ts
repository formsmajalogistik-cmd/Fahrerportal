// Einheitliche Schreibweise für gesammelte und manuell gepflegte Werte.
//
// Ohne das stehen „bremen", „Bremen" und „BREMEN" als drei Einträge im
// Vorschlags-Pool und die Auswahl wird unbrauchbar. Normalisiert wird
// beim Sammeln UND bei manuellen Einträgen — für Bestandsdaten gibt es
// Migration 093.

/**
 * Jedes Wort beginnt groß. Bindestrich, Schrägstrich und Punkt trennen
 * Wörter mit („stuhr-heiligenrode" → „Stuhr-Heiligenrode").
 *
 * Zwei bewusste Ausnahmen:
 *   * Durchgehend groß geschriebene Wörter bleiben, wie sie sind — sonst
 *     würde aus „GmbH" zwar nichts, aus „BMW" oder „HB-AB 123" aber
 *     „Bmw" bzw. „Hb-Ab 123".
 *   * Der Rest des Wortes wird NICHT kleingeschrieben. „GmbH" bleibt
 *     „GmbH", „McDonald" bleibt „McDonald".
 *
 * Hausnummern bleiben unangetastet, weil sie mit einer Ziffer beginnen
 * („38e" wird nicht zu „38E").
 */
export function grossAnfang(wert: string): string {
  return wert.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (wort) => {
    const fest = RECHTSFORMEN.get(wort.toLowerCase());
    if (fest) return fest;
    if (wort.length > 1 && wort === wort.toLocaleUpperCase('de-DE')) return wort;
    return wort.charAt(0).toLocaleUpperCase('de-DE') + wort.slice(1);
  });
}

/**
 * Wenige eindeutige Rechtsformen, die sonst als „Gmbh" herauskämen.
 * Bewusst kurz gehalten und nur mehrdeutigkeitsfreie Kürzel — „AG" oder
 * „KG" bleiben draußen, weil sie auch normale Wortanfänge sein können.
 */
const RECHTSFORMEN = new Map<string, string>([
  ['gmbh', 'GmbH'],
  ['mbh', 'mbH'],
  ['ohg', 'OHG'],
  ['gbr', 'GbR'],
]);

/**
 * Pool-Schlüssel, deren Werte Namen sind und deshalb groß beginnen
 * sollen. E-Mail und Telefon stehen bewusst NICHT hier — eine
 * großgeschriebene Adresse wäre schlicht falsch.
 */
const GROSS_SCHREIBEN = new Set([
  'adresse_strasse', 'adresse_stadt', 'firma', 'kontaktname', 'fahrzeugmodell',
]);

/** Endung eines zusammengesetzten Schlüssels, z.B. „abholung_strasse". */
function endetAuf(typ: string, teil: string): boolean {
  return typ === teil || typ.endsWith(`_${teil}`);
}

/**
 * Wert passend zu seinem Pool-Schlüssel normalisieren.
 *
 * Adressteile werden auch bei abweichender Basis erkannt: ein Feld mit
 * eigenem feld_typ erzeugt Schlüssel wie „abholung_strasse".
 */
export function normalisiereFuerTyp(feldTyp: string, wert: string): string {
  const t = feldTyp.trim().toLowerCase();
  const sauber = wert.trim().replace(/\s+/g, ' ');
  if (!sauber) return sauber;
  // E-Mail: klein, das ist die übliche Schreibweise und macht die
  // Dublettenprüfung eindeutig.
  if (t === 'email' || endetAuf(t, 'email')) return sauber.toLowerCase();
  if (t === 'telefon' || endetAuf(t, 'telefon')) return sauber;
  // PLZ und alles Numerische bleibt unverändert.
  if (endetAuf(t, 'plz')) return sauber;
  if (GROSS_SCHREIBEN.has(t) || endetAuf(t, 'strasse') || endetAuf(t, 'stadt')) {
    return grossAnfang(sauber);
  }
  return sauber;
}

/** Adressteile einer manuell gepflegten Adresse (Adressbuch). */
export function normalisiereAdresse<T extends {
  strasse?: string | null; plz?: string | null; ort?: string | null;
}>(a: T): T {
  return {
    ...a,
    strasse: a.strasse ? grossAnfang(a.strasse.trim().replace(/\s+/g, ' ')) : a.strasse,
    plz: a.plz ? a.plz.trim() : a.plz,
    ort: a.ort ? grossAnfang(a.ort.trim().replace(/\s+/g, ' ')) : a.ort,
  };
}
