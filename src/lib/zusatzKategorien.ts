// Auswahl-Liste der möglichen Tour-Zusatz-Kategorien. Genutzt im
// Tour-Detail-Dialog (Zusatz anlegen) und im Rechnungsformat-Editor
// (Multi-Select "Zusätze auf Touren-Rechnung").
export const ZUSATZ_KATEGORIEN = [
  'Maut', 'Ladezeit', 'Wartezeit', 'Rote Kennzeichen', 'Reifenhandling',
  'Wäsche', 'Tankauslagen', 'Ladeauslagen', 'Waschauslagen',
  'Tank und Waschauslagen', 'Lade und Waschauslagen', 'Taxiauslagen',
] as const;

/**
 * Auswahl beim Erfassen von Zusätzen (Tour-Detail, Posteingang): zusätzlich
 * „Keine Auslagen" (Migration 113) — klärt den Auslagen-Status je
 * Kennzeichen, erscheint nie auf einer Rechnung. Bewusst NICHT in
 * ZUSATZ_KATEGORIEN (Rechnungsformat, Preisliste).
 */
export const ZUSATZ_KATEGORIEN_ERFASSUNG = [...ZUSATZ_KATEGORIEN, 'Keine Auslagen'] as const;
