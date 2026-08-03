// Tourenart automatisch setzen (AB ↔ ABC) — verhindert Abrechnungs-
// fehler, wenn eine Rückführung eingetragen ist, die Tourenart aber
// versehentlich auf "AB" stehen bleibt.
//
// Regeln:
//   * Default bei einer neuen Tour: AB.
//   * Wird eine Rückführung befüllt (Stadt ODER Adresse), springt die
//     Tourenart auf ABC.
//   * Wird die Rückführung wieder geleert, geht sie zurück auf AB.
//   * ABA muss bewusst gewählt werden. Sobald der Nutzer die Tourenart
//     EINMAL selbst angefasst hat, greift die Automatik nicht mehr —
//     sonst ließe sich ABA gar nicht halten, sobald eine Rückführung
//     existiert.
//
// Die manuelle Auswahl merkt sich der Aufrufer in einem eigenen
// Boolean-State (`manuell`), den er beim onChange des Selects setzt.

import type { TourenArt } from '../types/db';

/** Hat die Tour eine Rückführung? Stadt oder Adresse genügt. */
export function hatRueckfuehrungsdaten(
  stadt: string | null | undefined,
  adresse: string | null | undefined,
): boolean {
  return !!(stadt ?? '').trim() || !!(adresse ?? '').trim();
}

/**
 * Liefert die automatisch gewünschte Tourenart — oder `null`, wenn
 * nichts zu ändern ist (manuell übersteuert bzw. Wert passt schon).
 */
export function automatischeTourenart(args: {
  aktuell: TourenArt | '';
  rueckStadt: string;
  rueckAdresse: string;
  /** True, sobald der Nutzer die Tourenart selbst gewählt hat. */
  manuell: boolean;
}): TourenArt | null {
  if (args.manuell) return null;
  const hatRueck = hatRueckfuehrungsdaten(args.rueckStadt, args.rueckAdresse);
  const gewuenscht: TourenArt = hatRueck ? 'ABC' : 'AB';
  return args.aktuell === gewuenscht ? null : gewuenscht;
}

/**
 * Sicherheitsnetz beim Speichern: Rückführung befüllt, Tourenart aber
 * "AB"? Dann muss der Nutzer bestätigen — das fängt den Fall ab, in dem
 * die Automatik durch eine manuelle Auswahl deaktiviert wurde.
 */
export function brauchtAbcWarnung(
  tourenart: TourenArt | '' | null,
  rueckStadt: string | null | undefined,
  rueckAdresse: string | null | undefined,
): boolean {
  return tourenart === 'AB' && hatRueckfuehrungsdaten(rueckStadt, rueckAdresse);
}

export const ABC_WARNUNG_TEXT =
  'Es ist eine Rückführung eingetragen, die Tourenart ist aber AB. Bitte prüfen.';
