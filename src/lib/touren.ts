// Hilfsfunktionen rund um die Tourenliste.

import type { Tour } from '../types/db';

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

/** Berechnet die Gesamtstrecke aus km_hin und km_rueck. */
export function computeKmGesamt(args: {
  km_hin: number | null;
  km_rueck: number | null;
  hatRueckfuehrung: boolean;
}): number | null {
  const { km_hin, km_rueck, hatRueckfuehrung } = args;
  if (!hatRueckfuehrung) {
    return km_hin ?? null;
  }
  if (km_hin == null && km_rueck == null) return null;
  return (km_hin ?? 0) + (km_rueck ?? 0);
}

/** Baut den Routen-Titel: "Start → Ziel" bzw. "Start → Ziel → Rückführung". */
export function tourTitel(
  t: Pick<Tour, 'start_stadt' | 'ziel_stadt' | 'rueckfuehrung_stadt'>,
): string {
  const parts = [t.start_stadt, t.ziel_stadt];
  if (t.rueckfuehrung_stadt && t.rueckfuehrung_stadt.trim()) {
    parts.push(t.rueckfuehrung_stadt);
  }
  return parts.filter(Boolean).join(' → ');
}
