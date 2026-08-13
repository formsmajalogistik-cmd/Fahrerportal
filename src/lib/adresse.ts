// Strukturierte Stationsadresse (Migration 086).
//
// Die Adresse einer Station besteht aus der Straße (inkl. Hausnummer,
// wie in den Formularen), der PLZ — und der STADT, die identisch mit
// der Tour-Stadt ist
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
  /**
   * Straße MIT Hausnummer, genau wie in den Formularen
   * ("Heiligenroder Strasse 38e"). Migration 087 hat das frühere
   * separate Hausnummer-Feld wieder eingeschmolzen.
   */
  strasse: string | null;
  plz: string | null;
  /** Stadt der Station = Tour-Stadt. Nicht separat gespeichert. */
  stadt: string | null;
}

const leer = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Setzt "{strasse}, {plz} {stadt}" zusammen. Leere Teile fallen sauber
 * weg — es entstehen keine hängenden Kommas und kein "undefined".
 * Gibt null zurück, wenn nichts übrig bleibt.
 */
export function composeAdresse(teile: Partial<AdressTeile>): string | null {
  const strasse = leer(teile.strasse);
  const plz = leer(teile.plz);
  const stadt = leer(teile.stadt);
  const ortszeile = [plz, stadt].filter(Boolean).join(' ');
  const ganz = [strasse, ortszeile].filter(Boolean).join(', ');
  return ganz || null;
}

/**
 * Adresse einer Station für Anzeige und Routenberechnung.
 *
 * Sind Straße oder PLZ gepflegt, gewinnen die Einzelteile — sonst fällt
 * die Funktion auf den gespeicherten Freitext zurück. Genau das hält
 * Bestandstouren (Freitext, nie zerlegt) und neue Touren (Einzelteile)
 * im selben Code-Pfad.
 *
 * Die STADT allein zählt dabei ausdrücklich NICHT als Adresse: sie ist
 * bei jeder Tour gesetzt (NOT NULL seit Migration 012). Würde sie
 * genügen, lieferte eine Bestandstour nur noch "Bremen" statt ihrer
 * vollständigen Freitext-Adresse — mit Folgen bis in die
 * Routenberechnung.
 */
export function effektiveAdresse(
  teile: Partial<AdressTeile>,
  freitext: string | null | undefined,
): string {
  if (hatAdressTeile(teile)) return composeAdresse(teile) ?? '';
  const alt = leer(freitext);
  if (alt) return alt;
  // Weder Einzelteile noch Freitext — dann bleibt höchstens die Stadt.
  return composeAdresse(teile) ?? '';
}

/**
 * Hat die Station schon strukturierte Angaben? Steuert, ob der
 * Freitext einer Bestandstour zusätzlich als Hinweis angezeigt wird.
 */
export function hatAdressTeile(teile: Partial<AdressTeile>): boolean {
  return !!(leer(teile.strasse) || leer(teile.plz));
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

/**
 * Adress-Übernahme aus einem Protokoll in eine Station der Tour
 * (Migration 086/087).
 *
 * Regeln:
 *  - Es werden NUR leere Tour-Felder befüllt; vorhandene Werte bleiben.
 *  - Straße, PLZ und Stadt gehen in die strukturierten Spalten; das
 *    Freitextfeld `adresse_*` wird aus den EFFEKTIVEN Werten (alt + neu)
 *    zusammengesetzt, damit Auftrags-E-Mail, Export, PDF-Platzhalter und
 *    Routenberechnung unverändert funktionieren.
 *  - Die Stadt ist zugleich die Tour-Stadt (start_stadt / ziel_stadt /
 *    rueckfuehrung_stadt) — kein zweites Feld.
 *  - `trackKeys` enthält die Spalten, die beim „Verknüpfung lösen"
 *    zurückgesetzt werden dürfen. Die Stadt-Spalten fehlen dort
 *    absichtlich: sie sind NOT NULL (Migration 012).
 */
export function adressPatchFuerStation(args: {
  station: 'start' | 'ziel' | 'rueckfuehrung';
  /** Werte aus dem Protokoll. */
  neu: Partial<AdressTeile>;
  /** Aktuelle Werte der Tour. */
  alt: { strasse: string | null; plz: string | null; stadt: string | null; adresse: string | null };
}): { patch: Record<string, string>; trackKeys: string[]; labels: string[] } {
  const { station, neu, alt } = args;
  const stadtSpalte = station === 'rueckfuehrung' ? 'rueckfuehrung_stadt' : `${station}_stadt`;
  const patch: Record<string, string> = {};
  const trackKeys: string[] = [];
  const labels: string[] = [];
  const istLeer = (v: string | null | undefined) => !(v ?? '').trim();

  const setze = (spalte: string, label: string, altWert: string | null,
                 neuWert: string | null | undefined, track: boolean) => {
    if (!istLeer(altWert)) return;
    const w = (neuWert ?? '').trim();
    if (!w) return;
    patch[spalte] = w;
    labels.push(label);
    if (track) trackKeys.push(spalte);
  };

  setze(`strasse_${station}`, 'Straße', alt.strasse, neu.strasse, true);
  setze(`plz_${station}`, 'PLZ', alt.plz, neu.plz, true);
  // Stadt bewusst NICHT getrackt — NOT NULL, siehe oben.
  setze(stadtSpalte, 'Stadt', alt.stadt, neu.stadt, false);

  // Freitext nachziehen. Er ist ein ABGELEITETES Feld (genau wie beim
  // Speichern der Tour-Maske) und wird deshalb überschrieben, sobald
  // strukturierte Werte dazugekommen sind — sonst zeigte die Maske die
  // neue Adresse, Export und Auftrags-E-Mail aber weiter die alte.
  // Kam nichts Strukturiertes dazu, bleibt ein vorhandener Freitext
  // unangetastet.
  const etwasGefuellt = Object.keys(patch).length > 0;
  const eff = composeAdresse({
    strasse: patch[`strasse_${station}`] ?? alt.strasse,
    plz: patch[`plz_${station}`] ?? alt.plz,
    stadt: patch[stadtSpalte] ?? alt.stadt,
  });
  if (etwasGefuellt && eff && eff !== (alt.adresse ?? '').trim()) {
    patch[`adresse_${station}`] = eff;
    labels.push('Adresse');
    trackKeys.push(`adresse_${station}`);
  } else {
    setze(`adresse_${station}`, 'Adresse', alt.adresse, eff, true);
  }

  return { patch, trackKeys, labels };
}
