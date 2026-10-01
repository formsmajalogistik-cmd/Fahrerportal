// Platzhalter → fertiges Foto.
//
// Liegt ein Foto in der Upload-Warteschlange, steht im Formular ein
// Platzhalter `{ pending_id }`. Ist der Upload durch, muss genau DIESER
// Platzhalter durch `{ storage_path }` ersetzt werden — und zwar an drei
// Stellen gleich: im Entwurf auf dem Gerät, in einer wartenden
// Einreichung und im Stand auf dem Bildschirm.
//
// Früher ersetzte die Formularseite stattdessen ihren KOMPLETTEN Stand
// durch den Entwurf vom Gerät. Der wird aber erst 2 s nach der letzten
// Eingabe geschrieben — alles, was in diesem Fenster passiert war (z.B.
// gerade bestätigte Schadenpunkte), verschwand. Und die wartende
// Einreichung bekam die fertigen Fotos nie zu sehen.
//
// Bewusst ohne Supabase-/IDB-Import, damit die Regel für sich prüfbar ist.

import type { PhotoValue } from '../types/db';

function istPlatzhalter(v: unknown, pendingId: string): boolean {
  return !!v && typeof v === 'object'
    && (v as { pending_id?: unknown }).pending_id === pendingId;
}

/**
 * Ersetzt den Platzhalter mit `pendingId` durch `neu`.
 *
 *   * Einzelfoto-Feld: nur, wenn dort noch genau dieser Platzhalter steht.
 *     Hat der Fahrer inzwischen neu fotografiert oder gelöscht, gewinnt
 *     seine Eingabe — ein alter Upload überschreibt nichts.
 *   * Mehrfach-Feld (Zusatzbilder): nur der passende Eintrag der Liste.
 *
 * Gibt `undefined` zurück, wenn nichts zu ersetzen war — dann muss der
 * Aufrufer nichts schreiben.
 */
export function ersetzePendingFoto(
  aktuell: unknown,
  pendingId: string,
  neu: PhotoValue,
): unknown | undefined {
  if (Array.isArray(aktuell)) {
    let geaendert = false;
    const next = aktuell.map((slot) => {
      if (istPlatzhalter(slot, pendingId)) { geaendert = true; return neu; }
      return slot;
    });
    return geaendert ? next : undefined;
  }
  return istPlatzhalter(aktuell, pendingId) ? neu : undefined;
}

/** Hochgeladene UND noch wartende Fotos (Platzhalter) eines Zusatzbilder-Feldes. */
export function zusatzbilderAusWert(v: unknown): PhotoValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is PhotoValue =>
    !!x && typeof x === 'object' && (
      typeof (x as { storage_path?: unknown }).storage_path === 'string'
      || typeof (x as { pending_id?: unknown }).pending_id === 'string'
    ));
}
