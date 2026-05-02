// Hilfsfunktionen rund um die Tourenliste.

import { supabase } from './supabase';
import type { Tour, TourenArt } from '../types/db';

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

/**
 * Schlägt den Tour-Preis aus der Preisliste nach. Nutzt die Supabase-RPC
 * `calculate_tour_price`. Gibt `null` zurück wenn keine passende Preisstufe
 * gefunden wurde, Pflicht-Parameter fehlen oder ein Fehler auftritt.
 */
export async function fetchTourPrice(args: {
  auftraggeberId: string | null | undefined;
  km: number | null | undefined;
  tourenart?: TourenArt | null;
}): Promise<number | null> {
  if (!args.auftraggeberId || args.km == null) return null;
  const { data, error } = await supabase.rpc('calculate_tour_price', {
    p_auftraggeber_id: args.auftraggeberId,
    p_km: args.km,
    p_tourenart: args.tourenart ?? 'AB',
  });
  if (error) {
    console.warn('[fetchTourPrice]', error);
    return null;
  }
  return data == null ? null : Number(data);
}

/** Baut den Routen-Titel: "Start → Ziel" bzw. "Start → Ziel → Rückführung". */
export function tourTitel(
  t: Partial<Pick<Tour, 'start_stadt' | 'ziel_stadt' | 'rueckfuehrung_stadt'>> | null | undefined,
): string {
  if (!t) return '';
  const parts: string[] = [];
  if (t.start_stadt) parts.push(t.start_stadt);
  if (t.ziel_stadt) parts.push(t.ziel_stadt);
  if (t.rueckfuehrung_stadt && t.rueckfuehrung_stadt.trim()) {
    parts.push(t.rueckfuehrung_stadt);
  }
  return parts.filter(Boolean).join(' → ');
}
