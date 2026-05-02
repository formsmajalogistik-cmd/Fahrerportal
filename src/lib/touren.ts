// Hilfsfunktionen rund um die Tourenliste.

import type { Tour, Zwischenstopp } from '../types/db';

const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('de-DE');

const DATETIME = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export function formatEuro(value: number | null | undefined): string {
  if (value == null) return '—';
  return EUR.format(Number(value));
}

export function formatKm(value: number | null | undefined): string {
  if (value == null) return '— km';
  return `${NUM.format(value)} km`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return DATETIME.format(d);
}

/** Berechnet die Gesamtstrecke aus Start, Stopps und Ziel. */
export function computeKmGesamt(args: {
  km_start_bis_erster_stopp: number | null;
  zwischenstopps: Zwischenstopp[];
  km_letzter_stopp_bis_ziel: number | null;
}): number | null {
  const { km_start_bis_erster_stopp, zwischenstopps, km_letzter_stopp_bis_ziel } = args;
  if (zwischenstopps.length === 0) {
    return km_start_bis_erster_stopp ?? null;
  }
  let total = km_start_bis_erster_stopp ?? 0;
  for (const stop of zwischenstopps) {
    total += Number(stop.km_ab_vorher) || 0;
  }
  total += km_letzter_stopp_bis_ziel ?? 0;
  return total;
}

/** Baut den Routen-Titel aus Start → (Stopps) → Ziel. */
export function tourTitel(t: Pick<Tour, 'start_stadt' | 'ziel_stadt' | 'zwischenstopps'>): string {
  const parts = [t.start_stadt, ...t.zwischenstopps.map((s) => s.stadt), t.ziel_stadt];
  return parts.filter(Boolean).join(' → ');
}
