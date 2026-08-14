// Tour an ein eigenes Unterkonto übergeben (Migration 089).
//
// Ein Fahrer-Hauptkonto kann eine ihm zugewiesene Tour an eines seiner
// eigenen Unterkonten weiterreichen — und zurück, und zwischen
// Unterkonten.
//
// Die Berechtigung liegt AUSSCHLIESSLICH serverseitig: `tour_uebergeben`
// ist SECURITY DEFINER, prüft beide Enden gegen die eigene Konto-Familie
// und schreibt nur die Spalte `fahrer_id`. Die frühere breite
// UPDATE-Policy `touren_self_reassign` (024) ist mit 089 entfallen —
// über sie konnten Fahrer auch Preis und km ihrer Touren ändern.

import { supabase } from './supabase';
import type { Fahrer } from '../types/db';

export interface UebergabeErgebnis {
  ok: boolean;
  fehler?: string;
  alt?: string;
  neu?: string;
  unveraendert?: boolean;
}

export async function tourUebergeben(
  tourId: string,
  neuerFahrerId: string,
): Promise<UebergabeErgebnis> {
  const { data, error } = await supabase.rpc('tour_uebergeben', {
    p_tour_id: tourId,
    p_neuer_fahrer_id: neuerFahrerId,
  });
  if (error) {
    console.warn('[Tour-Übergabe]', error);
    return { ok: false, fehler: 'Die Tour konnte nicht übergeben werden.' };
  }
  return (data as unknown as UebergabeErgebnis)
    ?? { ok: false, fehler: 'Keine Antwort vom Server.' };
}

/** Anzeigename eines Fahrer-Eintrags — Unterkonten haben eigene Namen. */
export function fahrerKontoName(f: Fahrer): string {
  const eigen = [f.vorname, f.nachname].filter((x) => (x ?? '').trim()).join(' ').trim();
  if (eigen) return eigen;
  return f.ist_unterkonto ? 'Unterkonto' : 'Hauptkonto';
}
