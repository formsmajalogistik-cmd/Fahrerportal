// Hilfsfunktionen rund um die Tourenliste.

import { supabase } from './supabase';
import type { Tour, TourenArt, TourStatus } from '../types/db';

const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('de-DE');

const DATETIME = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

const DATE = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric',
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

/** Datum ohne Uhrzeit ("dd.mm.yyyy"). Akzeptiert ISO-Date oder Timestamp. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return DATE.format(d);
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
  istEFahrzeug?: boolean;
}): Promise<number | null> {
  if (!args.auftraggeberId || args.km == null) return null;
  const { data, error } = await supabase.rpc('calculate_tour_price', {
    p_auftraggeber_id: args.auftraggeberId,
    p_km: args.km,
    p_tourenart: args.tourenart ?? 'AB',
    p_ist_e_fahrzeug: !!args.istEFahrzeug,
  });
  if (error) {
    console.warn('[fetchTourPrice]', error);
    return null;
  }
  return data == null ? null : Number(data);
}

export interface TourPriceBreakdown {
  base: number;
  abaAufschlag: number;
  eAufschlag: number;
  total: number;
}

/**
 * Liefert die Aufschlüsselung des Tour-Preises (Basispreis, ABA-Aufschlag,
 * E-Fahrzeug-Aufschlag, Summe). Kommt direkt aus den Tabellen statt aus der
 * RPC, damit das Frontend die Komponenten getrennt anzeigen kann.
 */
export async function fetchTourPriceBreakdown(args: {
  auftraggeberId: string | null | undefined;
  km: number | null | undefined;
  tourenart?: TourenArt | null;
  istEFahrzeug?: boolean;
}): Promise<TourPriceBreakdown | null> {
  if (!args.auftraggeberId || args.km == null) return null;
  const km = args.km;
  const [stufeRes, agRes] = await Promise.all([
    supabase
      .from('preisstufen')
      .select('preis, e_fahrzeug_aufschlag')
      .eq('auftraggeber_id', args.auftraggeberId)
      .lte('km_von', km)
      .gte('km_bis', km)
      .order('km_von', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('auftraggeber')
      .select('aba_aufschlag_prozent')
      .eq('id', args.auftraggeberId)
      .maybeSingle(),
  ]);
  if (stufeRes.error) { console.warn('[fetchTourPriceBreakdown stufe]', stufeRes.error); return null; }
  const stufe = stufeRes.data;
  if (!stufe) return null;
  const base = Math.round(Number(stufe.preis) * 100) / 100;
  let abaAufschlag = 0;
  if (args.tourenart === 'ABA') {
    const prozent = Number(agRes.data?.aba_aufschlag_prozent ?? 0);
    if (prozent > 0) abaAufschlag = Math.round(base * prozent) / 100;
  }
  const eAufschlag = args.istEFahrzeug
    ? Math.round(Number(stufe.e_fahrzeug_aufschlag ?? 0) * 100) / 100
    : 0;
  const total = Math.round((base + abaAufschlag + eAufschlag) * 100) / 100;
  return { base, abaAufschlag, eAufschlag, total };
}

function ymdKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function parseYmd(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return ymdKey(d);
}

/**
 * Berechnet den Tour-Status — vereinfachte Regel:
 *   - 'aktiv':         Enddatum ist heute
 *   - 'abgeschlossen': Enddatum liegt in der Vergangenheit
 *   - 'geplant':       Enddatum liegt in der Zukunft ODER ist nicht gesetzt
 *
 * Das Startdatum spielt keine Rolle. Verglichen wird auf Tagesebene.
 *
 * Das 1. Argument bleibt aus historischen Gründen `startdatum`, wird
 * aber nicht mehr ausgewertet — Aufrufer müssen das 2. Argument
 * (enddatum) übergeben.
 */
export function computeTourStatus(
  _startdatum: string | null | undefined,
  enddatum?: string | null | undefined,
): TourStatus {
  const end = parseYmd(enddatum);
  if (end == null) return 'geplant';
  const today = ymdKey(new Date());
  if (end < today) return 'abgeschlossen';
  if (end > today) return 'geplant';
  return 'aktiv';
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
