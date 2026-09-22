// Wann erscheint ein zugewiesenes Protokoll im Formulare-Reiter des
// Fahrers?
//
// Die Regel steckte bisher mitten in FahrerDashboard und war damit nicht
// prüfbar. Sie liegt hier, weil genau an ihr der Fehler hing
// „zugewiesenes Protokoll taucht beim Fahrer nicht auf" — und weil der
// entscheidende Punkt eine Kleinigkeit ist, die man beim Lesen leicht
// übersieht: der Schlüssel der „erledigt"-Prüfung.

import type { TourStatus } from '../types/db';

/**
 * Schlüssel der „erledigt"-Prüfung: Tour UND Template.
 *
 * Nicht das Template allein und auch nicht Template + Fahrer. Dasselbe
 * Protokoll kann am selben Tag an mehrere Touren und mehrere Fahrer
 * gehen; jede dieser Zuweisungen wird eigenständig ausgefüllt und
 * eingereicht. Ein gröberer Schlüssel würde mit der ersten Einreichung
 * alle übrigen Zuweisungen mit ausblenden.
 */
export function zuweisungsSchluessel(tourId: string, templateId: string): string {
  return `${tourId}|${templateId}`;
}

export interface ZuweisungsLage {
  /** Status der Tour, berechnet mit computeTourStatus(). */
  tourStatus: TourStatus;
  /** Offener Entwurf dieses Fahrers zu genau dieser Tour + diesem Template. */
  hatOffenenEntwurf: boolean;
  /** Eingereichtes Formular zu genau dieser Tour + diesem Template. */
  bereitsEingereicht: boolean;
}

/**
 * Gehört die Zuweisung in die To-Do-Liste des Fahrers?
 *
 *  1. Eingereicht (für DIESE Tour + DIESES Template) → weg. Ausnahme: es
 *     liegt noch ein offener Entwurf daneben, sonst wäre der zweite,
 *     bereits begonnene Stand nicht mehr erreichbar.
 *  2. Tour geplant oder aktiv → anzeigen.
 *  3. Tour abgeschlossen → nur noch, solange ein offener Entwurf da ist.
 *
 * Ob das Protokoll sichtbar oder unsichtbar ist, spielt hier bewusst
 * keine Rolle: ein unsichtbares Template kommt überhaupt nur über eine
 * Zuweisung hierher. Das Leserecht darauf regelt die RLS
 * (Migration 098), nicht diese Funktion.
 */
export function zeigeTourProtokoll(lage: ZuweisungsLage): boolean {
  if (lage.bereitsEingereicht && !lage.hatOffenenEntwurf) return false;
  if (lage.tourStatus === 'geplant' || lage.tourStatus === 'aktiv') return true;
  return lage.hatOffenenEntwurf;
}
