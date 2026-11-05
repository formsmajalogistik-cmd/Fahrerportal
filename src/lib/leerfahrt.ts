// „Leerfahrt" je Tour (Migration 114, nur Admin).
//
// Setzen: Markierung (tour_leerfahrt) + für jedes Kennzeichen ohne echte
// Auslage ein „Keine Auslagen" — mit derselben Funktion wie der Button
// „Keine Auslagen", nur mit herkunft 'leerfahrt'. Entfernen nimmt genau
// diese automatischen Einträge wieder weg (in der Datenbankfunktion);
// manuell gesetzte „Keine Auslagen" bleiben. Keine Auswirkung auf Preis,
// Rechnung, Gutschrift oder Vergütung.

import { supabase } from './supabase';
import { inStuecken } from './ladeInBloecken';
import { keineAuslagenFuerUngeklaerte } from './auslagenStatus';

export interface LeerfahrtInfo { gesetzt_am: string; gesetzt_von_name: string | null }

/** Leerfahrten der Touren. `fehlt`: Migration 114 noch nicht eingespielt. */
export async function ladeLeerfahrten(tourIds: string[]): Promise<{ map: Map<string, LeerfahrtInfo>; fehlt: boolean }> {
  const map = new Map<string, LeerfahrtInfo>();
  for (const stueck of inStuecken([...new Set(tourIds.filter(Boolean))], 150)) {
    const { data, error } = await supabase.from('tour_leerfahrt').select('tour_id, gesetzt_am, gesetzt_von_name').in('tour_id', stueck);
    if (error) return { map, fehlt: true };
    for (const r of (data ?? []) as Array<{ tour_id: string } & LeerfahrtInfo>) {
      map.set(r.tour_id, { gesetzt_am: r.gesetzt_am, gesetzt_von_name: r.gesetzt_von_name });
    }
  }
  return { map, fehlt: false };
}

/** Als Leerfahrt markieren; liefert die Zahl angelegter „Keine Auslagen". */
export async function leerfahrtSetzen(tourId: string): Promise<number> {
  const { error } = await supabase.rpc('tour_leerfahrt_setzen', { p_tour_id: tourId, p_an: true });
  if (error) throw new Error(error.message);
  return keineAuslagenFuerUngeklaerte([tourId], undefined, 'leerfahrt');
}

/** Leerfahrt entfernen; liefert die Zahl entfernter automatischer „Keine Auslagen". */
export async function leerfahrtEntfernen(tourId: string): Promise<number> {
  const { data, error } = await supabase.rpc('tour_leerfahrt_setzen', { p_tour_id: tourId, p_an: false });
  if (error) throw new Error(error.message);
  return Number((data as { entfernt?: number } | null)?.entfernt ?? 0);
}

export const LEERFAHRT_ENTFERNEN_FRAGE = 'Leerfahrt entfernen? Die automatisch gesetzten „Keine Auslagen" werden ebenfalls entfernt.';
