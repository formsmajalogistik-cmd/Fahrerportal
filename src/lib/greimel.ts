// Helpers für die Greimel-Zugang-Verknüpfung an Touren.

import { supabase } from './supabase';
import type { GreimelZugang } from '../types/db';

/** Erkennt, ob ein Auftraggeber ein Greimel-Konto ist (case-insensitive). */
export function isGreimelAuftraggeber(
  ag: { name?: string | null } | null | undefined,
): boolean {
  if (!ag?.name) return false;
  return ag.name.trim().toLowerCase().includes('greimel');
}

/**
 * Fügt einen Fahrer zu einem Greimel-Zugang hinzu (idempotent). Liest den
 * aktuellen Stand erst, damit konkurrente Updates die Liste nicht überschreiben.
 */
export async function assignFahrerToZugang(
  zugangId: string,
  fahrerId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('greimel_zugaenge')
    .select('fahrer_ids')
    .eq('id', zugangId)
    .single();
  if (error) throw error;
  const current: string[] = Array.isArray(data?.fahrer_ids) ? data.fahrer_ids : [];
  if (current.includes(fahrerId)) return;
  const next = [...current, fahrerId];
  const { error: updateErr } = await supabase
    .from('greimel_zugaenge')
    .update({ fahrer_ids: next })
    .eq('id', zugangId);
  if (updateErr) throw updateErr;
}

/**
 * Entfernt einen Fahrer aus einem Zugang, ABER nur wenn er keine andere
 * nicht-abgeschlossene Tour (enddatum >= heute) mit demselben Zugang hat
 * — z.B. beim Löschen einer Tour oder beim Fahrer-Wechsel. `excludeTourId`
 * nimmt die gerade gelöschte/geänderte Tour aus der Prüfung heraus.
 */
export async function releaseZugangIfUnused(
  zugangId: string,
  fahrerId: string,
  excludeTourId?: string | null,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let q = supabase
    .from('touren')
    .select('id', { count: 'exact', head: true })
    .eq('greimel_zugang_id', zugangId)
    .eq('fahrer_id', fahrerId)
    .gte('enddatum', today);
  if (excludeTourId) q = q.neq('id', excludeTourId);
  const { count, error } = await q;
  if (error) throw error;
  if ((count ?? 0) > 0) return; // andere aktive Tour nutzt den Zugang noch
  await unassignFahrerFromZugang(zugangId, fahrerId);
}

/** Entfernt einen Fahrer aus einem Greimel-Zugang (idempotent). */
export async function unassignFahrerFromZugang(
  zugangId: string,
  fahrerId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('greimel_zugaenge')
    .select('fahrer_ids')
    .eq('id', zugangId)
    .single();
  if (error) throw error;
  const current: string[] = Array.isArray(data?.fahrer_ids) ? data.fahrer_ids : [];
  const next = current.filter((id) => id !== fahrerId);
  if (next.length === current.length) return;
  const { error: updateErr } = await supabase
    .from('greimel_zugaenge')
    .update({ fahrer_ids: next })
    .eq('id', zugangId);
  if (updateErr) throw updateErr;
}

/**
 * Filtert Greimel-Zugänge, die für diesen Fahrer als zugewiesener
 * Tour-Zugang in Frage kommen: entweder noch keinem Fahrer zugewiesen
 * oder bereits dem GLEICHEN Fahrer zugewiesen.
 *
 * `currentZugangId` (= aktueller Zugang dieser Tour) ist immer auswählbar,
 * unabhängig vom Filter, damit der Wert sichtbar bleibt.
 */
export function filterAvailableZugaenge(
  zugaenge: GreimelZugang[],
  fahrerId: string | null,
  currentZugangId: string | null,
): GreimelZugang[] {
  return (zugaenge ?? []).filter((z) => {
    if (currentZugangId && z.id === currentZugangId) return true;
    const ids = Array.isArray(z.fahrer_ids) ? z.fahrer_ids : [];
    if (ids.length === 0) return true;
    if (fahrerId && ids.includes(fahrerId)) return true;
    return false;
  });
}
