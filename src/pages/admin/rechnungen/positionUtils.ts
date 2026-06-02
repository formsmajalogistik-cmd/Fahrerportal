// Hilfsfunktionen für die Positions-Tabelle im Rechnungs-Editor.

import type { GeneratedRechnungsposition } from '../../../lib/rechnungsformat';

/** Editor-Zeile: GeneratedRechnungsposition plus stabiler React-Key. */
export interface EditorPosition extends GeneratedRechnungsposition {
  /** Stabiler Schlüssel für React. Bei DB-Zeilen die echte UUID, bei
   *  neu erzeugten Zeilen ein zufälliger String. */
  key: string;
}

let counter = 0;
export function newKey(prefix = 'p'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyManuellePosition(): EditorPosition {
  return {
    key: newKey('manual'),
    bezeichnung: '',
    unterzeilen: [],
    menge: 1,
    einzelpreis: 0,
    gesamtpreis: 0,
    tour_id: null,
    zusatz_id: null,
    ist_manuell: true,
    ust_satz: null,
  };
}

/** Multipliziert menge × einzelpreis und rundet auf 2 Nachkommastellen. */
export function recomputeGesamt(p: EditorPosition): EditorPosition {
  const menge = Number(p.menge) || 0;
  const einzel = Number(p.einzelpreis) || 0;
  return { ...p, gesamtpreis: Math.round(menge * einzel * 100) / 100 };
}

/** Parst eine deutsche Dezimalzahl-Eingabe ("12,50") in number. */
export function parseDecimal(s: string): number {
  const cleaned = (s ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Formatiert eine Zahl als deutsche Dezimal-Eingabe ohne Währung. */
export function formatDecimal(n: number, fractionDigits = 2): string {
  return (Math.round(n * Math.pow(10, fractionDigits)) / Math.pow(10, fractionDigits))
    .toFixed(fractionDigits).replace('.', ',');
}
