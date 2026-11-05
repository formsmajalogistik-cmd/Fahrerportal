// Globale Rechnungs-Einstellungen (app_settings, Schlüssel
// 'rechnung_einstellungen'). Vorerst nur das Standard-Zahlungsziel für
// manuelle Rechnungen (Migration 115) — Vorschlag 14 Tage.

import { supabase } from './supabase';
import type { Json } from '../types/supabase';

const KEY = 'rechnung_einstellungen';

export interface RechnungEinstellungen {
  standard_zahlungsziel_tage: number;
}

export const STANDARD_RECHNUNG_EINSTELLUNGEN: RechnungEinstellungen = {
  standard_zahlungsziel_tage: 14,
};

export function parseRechnungEinstellungen(raw: unknown): RechnungEinstellungen {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const z = Number(o.standard_zahlungsziel_tage);
  return {
    standard_zahlungsziel_tage: Number.isInteger(z) && z >= 0 && z <= 365
      ? z : STANDARD_RECHNUNG_EINSTELLUNGEN.standard_zahlungsziel_tage,
  };
}

export async function ladeRechnungEinstellungen(): Promise<RechnungEinstellungen> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) {
    console.warn('[rechnungEinstellungen.laden]', error.message);
    return STANDARD_RECHNUNG_EINSTELLUNGEN;
  }
  return parseRechnungEinstellungen(data?.value ?? null);
}

export async function speichereRechnungEinstellungen(e: RechnungEinstellungen): Promise<void> {
  const value = parseRechnungEinstellungen(e);
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: KEY, value: value as unknown as Json }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}
