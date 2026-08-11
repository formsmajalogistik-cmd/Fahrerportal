// Strukturierte Stationsadresse (Migration 086).
//
// Die Adresse einer Station besteht seit 086 aus Straße, Hausnummer,
// PLZ — und der STADT, die identisch mit der Tour-Stadt ist
// (start_stadt / ziel_stadt / rueckfuehrung_stadt). Es gibt bewusst
// kein zweites Stadt-Feld: derselbe Wert erscheint in der Tourenliste
// als Route und im Adressblock, egal an welcher Stelle er bearbeitet
// wird.
//
// Das alte Freitextfeld `adresse_*` bleibt bestehen und wird aus den
// Einzelteilen zusammengesetzt. Daran hängen Auftrags-E-Mail,
// Excel-Export und die Routenberechnung — die funktionieren dadurch
// unverändert weiter, auch für Bestandstouren, deren Freitext nie
// zerlegt wurde.

export interface AdressTeile {
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  /** Stadt der Station = Tour-Stadt. Nicht separat gespeichert. */
  stadt: string | null;
}

const leer = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Setzt "Straße Nr., PLZ Stadt" zusammen. Leere Teile fallen sauber
 * weg — es entstehen keine hängenden Kommas und kein "undefined".
 * Gibt null zurück, wenn nichts übrig bleibt.
 */
export function composeAdresse(teile: Partial<AdressTeile>): string | null {
  const strasse = leer(teile.strasse);
  const hausnummer = leer(teile.hausnummer);
  const plz = leer(teile.plz);
  const stadt = leer(teile.stadt);
  const zeile1 = [strasse, hausnummer].filter(Boolean).join(' ');
  const zeile2 = [plz, stadt].filter(Boolean).join(' ');
  const ganz = [zeile1, zeile2].filter(Boolean).join(', ');
  return ganz || null;
}

/**
 * Adresse einer Station für Anzeige und Routenberechnung.
 *
 * Sind Einzelteile gepflegt, gewinnen sie — sonst fällt die Funktion
 * auf den gespeicherten Freitext zurück. Genau das hält Bestandstouren
 * (Freitext, nie zerlegt) und neue Touren (Einzelteile) im selben
 * Code-Pfad.
 */
export function effektiveAdresse(
  teile: Partial<AdressTeile>,
  freitext: string | null | undefined,
): string {
  const zusammengesetzt = composeAdresse(teile);
  if (zusammengesetzt) return zusammengesetzt;
  return leer(freitext);
}

/**
 * Hat die Station schon strukturierte Angaben? Steuert, ob der
 * Freitext einer Bestandstour zusätzlich als Hinweis angezeigt wird.
 */
export function hatAdressTeile(teile: Partial<AdressTeile>): boolean {
  return !!(leer(teile.strasse) || leer(teile.hausnummer) || leer(teile.plz));
}

/**
 * Freitext einer Bestandstour, der noch nicht in Einzelteile überführt
 * wurde — sonst null. Bewusst KEIN automatisches Zerlegen: das Parsen
 * von "Musterstr. 1a, 28195 Bremen" ist zu fehleranfällig (fehlende
 * PLZ, Zusätze wie "Hinterhof", Auslandsformate).
 */
export function altAdresseHinweis(
  teile: Partial<AdressTeile>,
  freitext: string | null | undefined,
): string | null {
  if (hatAdressTeile(teile)) return null;
  const t = leer(freitext);
  return t || null;
}
