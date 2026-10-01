// Einordnung von Bild-Sektionen (`dynamic_photos`): Beleg oder Zusatzbild?
//
// Beide haben denselben Feldtyp, landen aber in verschiedenen PDFs.
// Ursprünglich für die nachträgliche Beleg-Ergänzung gebaut (vorher nahm
// sie blind das ERSTE Bild-Feld), jetzt auch vom Foto-Dialog der
// Schadensaufnahme genutzt — der hatte denselben Fehler in die andere
// Richtung: Schadenfotos landeten bei den Belegen, wenn die Beleg-Sektion
// vorne stand.
//
// Bewusst ohne weitere Importe, damit die Regeln für sich prüfbar sind.

import type { FormSchema } from '../types/db';

/**
 * Art einer Bild-Sektion. Beide sind technisch `dynamic_photos`, landen
 * aber in verschiedenen PDFs — Belege in der Belege-Sektion, Zusatz-
 * bilder in der Zusatzbilder-PDF.
 */
export type BelegFeldArt = 'beleg' | 'zusatz' | 'unbekannt';

export interface BelegFeld {
  id: string;
  label: string;
  art: BelegFeldArt;
}

const BELEG_WORTE  = ['beleg', 'quittung', 'kassenbon', 'bon', 'rechnung', 'tankquittung', 'nachweis'];
const ZUSATZ_WORTE = ['zusatz', 'zusatzbild', 'weitere', 'sonstige', 'extra'];

/**
 * Ordnet ein Bild-Feld anhand von Feld-ID und Beschriftung ein.
 *
 * Warum überhaupt: Belege und Zusatzbilder haben denselben Feldtyp.
 * Vorher nahm die Ergänzung immer das ERSTE `dynamic_photos`-Feld des
 * Schemas — stand die Zusatzbilder-Sektion davor, landeten ergänzte
 * Belege dort und tauchten folglich nie in der Belege-PDF auf.
 *
 * "Zusatz" wird zuerst geprüft: eine Sektion „Zusatzbelege" ist eher
 * Zusatz als Beleg, und die Zusatz-Wörter sind die spezifischeren.
 */
export function belegFeldArt(id: string, label: string): BelegFeldArt {
  const text = `${id} ${label}`.toLowerCase();
  if (ZUSATZ_WORTE.some((w) => text.includes(w))) return 'zusatz';
  if (BELEG_WORTE.some((w) => text.includes(w))) return 'beleg';
  return 'unbekannt';
}

/**
 * Alle `dynamic_photos`-Felder des Templates, jeweils mit ihrer Art.
 * Hat ein Template mehrere, muss der Admin wählen.
 */
export function belegFelder(
  schema: FormSchema | null | undefined,
): BelegFeld[] {
  const out: BelegFeld[] = [];
  for (const s of schema?.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f?.type === 'dynamic_photos') {
        const label = f.label || f.id;
        out.push({ id: f.id, label, art: belegFeldArt(f.id, label) });
      }
    }
  }
  return out;
}

/**
 * Das Feld, in das ergänzte Belege gehören: die Beleg-Sektion.
 *
 * Gibt es keine, kommt null zurück — dann wird bewusst NICHT auf die
 * Zusatzbilder-Sektion ausgewichen, sondern der Admin gefragt. Ein
 * unklassifiziertes Feld gilt als brauchbar, solange es das einzige
 * ist; sonst bleibt die Wahl beim Admin.
 */
export function standardBelegFeld(
  schema: FormSchema | null | undefined,
): BelegFeld | null {
  const felder = belegFelder(schema);
  const belege = felder.filter((f) => f.art === 'beleg');
  if (belege.length > 0) return belege[0];
  const offen = felder.filter((f) => f.art !== 'zusatz');
  if (offen.length === 1) return offen[0];
  return null;
}

/**
 * Das Feld, in das Fotos nach dem Setzen eines Schadenpunkts gehören:
 * die Zusatzbilder.
 *
 *   * ein als Zusatzbilder erkanntes Feld → das erste davon,
 *   * sonst ein nicht eingeordnetes Feld, wenn es genau eines gibt,
 *   * nie ein Beleg-Feld — dann lieber null und ein klarer Hinweis, als
 *     Schadenfotos still bei den Belegen abzulegen.
 */
export function schadenfotoZiel(schema: FormSchema | null | undefined): BelegFeld | null {
  const felder = belegFelder(schema);
  const zusatz = felder.find((f) => f.art === 'zusatz');
  if (zusatz) return zusatz;
  const offen = felder.filter((f) => f.art === 'unbekannt');
  return offen.length === 1 ? offen[0] : null;
}
