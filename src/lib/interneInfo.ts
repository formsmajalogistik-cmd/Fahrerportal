// „Interne Info (nur Admin)" und Leerfahrt-Grund (Migration 120).
//
// Liegt in der eigenen Tabelle touren_admin_info mit RLS „nur Admin" —
// Fahrer, Auftraggeber und Test-Konto bekommen von der Datenbank nichts.
// Aufrufer laden die Daten trotzdem nur in Admin-Ansichten (profile.role
// === 'admin'), damit gar keine Anfrage entsteht.
//
// NIE verwenden in: Rechnungs-PDF, E-Rechnung, E-Mails/Platzhaltern,
// Fahrer-/Auftraggeber-Ansicht, Kundensicht.

import { supabase } from './supabase';
import { inStuecken } from './ladeInBloecken';
import { keineAuslagenFuerUngeklaerte } from './auslagenStatus';
import { leerfahrtZeile } from './leerfahrtGruende';

export interface AdminInfo {
  interne_info: string | null;
  leerfahrt_grund: string | null;
  leerfahrt_text: string | null;
}

let schema: Promise<boolean> | null = null;
/** Ist Migration 120 eingespielt? (einmal je Sitzung geprüft) */
export function interneInfoVorhanden(): Promise<boolean> {
  if (!schema) {
    schema = (async () => {
      const { error } = await supabase.from('touren_admin_info').select('tour_id').limit(1);
      if (!error) return true;
      console.warn('[interneInfo] Migration 120 nicht erkannt:', error.message);
      schema = null;
      return false;
    })();
  }
  return schema;
}

/** Interne Infos der Touren (nur Admin). Fehlt die Migration: leere Map. */
export async function ladeAdminInfos(tourIds: string[]): Promise<Map<string, AdminInfo>> {
  const map = new Map<string, AdminInfo>();
  const ids = [...new Set(tourIds.filter(Boolean))];
  if (ids.length === 0 || !(await interneInfoVorhanden())) return map;
  for (const stueck of inStuecken(ids, 150)) {
    const { data, error } = await supabase.from('touren_admin_info')
      .select('tour_id, interne_info, leerfahrt_grund, leerfahrt_text').in('tour_id', stueck);
    if (error) { console.warn('[interneInfo] Laden fehlgeschlagen', error.message); return map; }
    for (const r of (data ?? []) as Array<{ tour_id: string } & AdminInfo>) {
      map.set(r.tour_id, { interne_info: r.interne_info, leerfahrt_grund: r.leerfahrt_grund, leerfahrt_text: r.leerfahrt_text });
    }
  }
  return map;
}

/** Nur die nicht leeren internen Infos, getrimmt — für Anzeigen wie bei touren.info. */
export async function ladeInterneInfoTexte(tourIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const [id, i] of await ladeAdminInfos(tourIds)) {
    const t = i.interne_info?.trim();
    if (t) m.set(id, t);
  }
  return m;
}

/** Interne Info speichern (leer = löschen des Textes, Zeile bleibt für den Grund). */
export async function speichereInterneInfo(tourId: string, text: string | null): Promise<void> {
  const wert = text && text.trim() ? text.replace(/\s+$/, '') : null;
  const { error } = await supabase.from('touren_admin_info')
    .upsert({ tour_id: tourId, interne_info: wert }, { onConflict: 'tour_id' });
  if (error) throw new Error(error.message);
}

export interface LeerfahrtErgebnis {
  /** Zahl automatisch gesetzter bzw. entfernter „Keine Auslagen". */
  auslagen: number;
  /** Systemzeile in der internen Info war von Hand geändert → nicht angefasst. */
  infoManuell: boolean;
}

export const INFO_MANUELL_HINWEIS = 'Eintrag in der internen Info wurde manuell geändert — bitte selbst anpassen.';

/** Leerfahrt mit Grund setzen bzw. Grund ändern. */
export async function leerfahrtMitGrund(tourId: string, grund: string, text: string | null): Promise<LeerfahrtErgebnis> {
  const { data, error } = await supabase.rpc('tour_leerfahrt_mit_grund', {
    p_tour_id: tourId, p_an: true, p_grund: grund, p_text: text?.trim() || null, p_zeile: leerfahrtZeile(grund, text),
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { neu_markiert?: boolean; info_manuell?: boolean };
  // „Keine Auslagen" wie bisher (Migration 114) — nur beim erstmaligen Markieren.
  const auslagen = r.neu_markiert ? await keineAuslagenFuerUngeklaerte([tourId], undefined, 'leerfahrt') : 0;
  return { auslagen, infoManuell: !!r.info_manuell };
}

/** Leerfahrt entfernen (inkl. Zeile in der internen Info und automatischer „Keine Auslagen"). */
export async function leerfahrtEntfernenMitInfo(tourId: string): Promise<LeerfahrtErgebnis> {
  const { data, error } = await supabase.rpc('tour_leerfahrt_mit_grund', { p_tour_id: tourId, p_an: false });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { entfernt?: number; info_manuell?: boolean };
  return { auslagen: Number(r.entfernt ?? 0), infoManuell: !!r.info_manuell };
}
