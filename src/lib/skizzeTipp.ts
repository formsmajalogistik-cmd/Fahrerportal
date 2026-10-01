// Tipp-Erkennung und Koordinaten der Schadensskizze.
//
// Bewusst ohne React/DOM-Abhängigkeit, damit die Regeln prüfbar sind.

/** Höchster Abstand zwischen Aufsetzen und Abheben, damit es ein Tipp ist. */
export const TIPP_ABSTAND_PX = 12;
/** Wer sich zwischendurch weiter entfernt hat, hat verschoben, nicht getippt. */
export const TIPP_MAX_WEG_PX = 24;

export interface Punkt { x: number; y: number }

const abstand = (a: Punkt, b: Punkt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Ist die Geste ein Tipp?
 *
 * Vorher wurde die GESAMTE Wegstrecke aller Bewegungs-Ereignisse
 * aufsummiert und mit 8 px verglichen. Handys mit hoher Touch-Abtastrate
 * liefern während eines ganz normalen Tipps viele Mini-Bewegungen — die
 * Summe überschritt 8 px, der Tipp wurde verworfen. Auf solchen Geräten
 * ließ sich so gar kein Punkt setzen.
 *
 * Jetzt zählt der Abstand Aufsetzen → Abheben, plus die größte Entfernung
 * zwischendurch (damit ein Hin-und-zurück-Verschieben kein Tipp ist).
 */
export function istTipp(start: Punkt, ende: Punkt, maxEntfernung: number): boolean {
  return abstand(start, ende) < TIPP_ABSTAND_PX && maxEntfernung < TIPP_MAX_WEG_PX;
}

export interface Rechteck { left: number; top: number; width: number; height: number }

export type TippErgebnis =
  | { ok: true; x: number; y: number }
  | { ok: false; grund: 'bild_nicht_vermessen' | 'ausserhalb' };

/**
 * Prozent-Koordinaten des Tipps relativ zum Bild. `rect` ist das
 * aktuelle Bild-Rechteck inklusive Zoom/Verschiebung — gemessen im Moment
 * des Tipps, daher unempfindlich gegen Drehen und Seitenwechsel.
 *
 * Ein noch nicht geladenes Bild hat Höhe 0: dann ausdrücklich ablehnen,
 * statt mit Unendlich/NaN zu rechnen.
 */
export function punktAusTipp(clientX: number, clientY: number, rect: Rechteck): TippErgebnis {
  if (!(rect.width > 0) || !(rect.height > 0)) return { ok: false, grund: 'bild_nicht_vermessen' };
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    return { ok: false, grund: 'ausserhalb' };
  }
  return { ok: true, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}
