// Manuell gepflegte Adressen (Migration 090).
//
// Bewusst eine eigene Tabelle statt Einträgen in `feld_vorschlaege`:
// eine Adresse besteht aus drei zusammengehörigen Werten (Straße, PLZ,
// Ort), die bei der Auswahl GEMEINSAM gesetzt werden — der flache
// (feld_typ, wert)-Pool kann das nicht abbilden. Dazu kommt die
// Auftraggeber-Sichtbarkeit, die dort mit der Regel "Auftraggeber sehen
// den Pool gar nicht" kollidieren würde.
//
// Sichtbarkeit erzwingt die RLS, nicht dieses Modul:
//   * ohne auftraggeber_id → Admin + Fahrer
//   * mit  auftraggeber_id → zusätzlich genau dieser Auftraggeber
//   * ein Auftraggeber bekommt fremde Adressen nie geliefert

import { supabase } from './supabase';
import { grossAnfang } from './textNormalisierung';
import type { Database } from '../types/supabase';

export type Adressbucheintrag =
  Database['public']['Tables']['adressbuch']['Row'];

export interface AdressEntwurf {
  bezeichnung: string;
  strasse: string;
  plz: string;
  ort: string;
  /** '' = allgemein (Admin + Fahrer). */
  auftraggeberId: string;
  notiz: string;
}

export function leererAdressEntwurf(): AdressEntwurf {
  return { bezeichnung: '', strasse: '', plz: '', ort: '', auftraggeberId: '', notiz: '' };
}

export function entwurfAus(e: Adressbucheintrag): AdressEntwurf {
  return {
    bezeichnung: e.bezeichnung ?? '',
    strasse: e.strasse ?? '',
    plz: e.plz ?? '',
    ort: e.ort ?? '',
    auftraggeberId: e.auftraggeber_id ?? '',
    notiz: e.notiz ?? '',
  };
}

/** Einzeiler für Dropdown und Liste. */
export function adressZeile(e: Pick<Adressbucheintrag, 'bezeichnung' | 'strasse' | 'plz' | 'ort'>): string {
  const ortszeile = [e.plz, e.ort].filter((x) => (x ?? '').trim()).join(' ');
  const adresse = [e.strasse, ortszeile].filter((x) => (x ?? '').trim()).join(', ');
  const name = (e.bezeichnung ?? '').trim();
  if (name && adresse) return `${name} — ${adresse}`;
  return name || adresse || 'Ohne Angaben';
}

// ---------------------------------------------------------------
// Lesen — pro Session einmal, wie beim Vorschlags-Pool.
// ---------------------------------------------------------------
let cache: Promise<Adressbucheintrag[]> | null = null;

export async function ladeAdressbuch(): Promise<Adressbucheintrag[]> {
  if (cache) return await cache;
  cache = (async () => {
    const { data, error } = await supabase
      .from('adressbuch')
      .select('*')
      .order('bezeichnung', { ascending: true, nullsFirst: false })
      .order('ort', { ascending: true, nullsFirst: false });
    if (error) {
      // Auftraggeber ohne zugeordnete Adressen bekommen schlicht nichts.
      console.warn('[adressbuch] Laden fehlgeschlagen', error.message);
      return [];
    }
    return (data as Adressbucheintrag[]) ?? [];
  })();
  return await cache;
}

export function resetAdressbuchCache(): void {
  cache = null;
}

// ---------------------------------------------------------------
// Pflege — nur Admins kommen durch die RLS.
// ---------------------------------------------------------------

function toRow(e: AdressEntwurf) {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  // Straße, Ort und Bezeichnung mit großem Anfangsbuchstaben — sonst
  // stehen manuelle Adressen anders geschrieben da als die gesammelten
  // Vorschläge (4a). PLZ bleibt unverändert.
  const g = (v: string) => (v.trim() ? grossAnfang(v.trim().replace(/\s+/g, ' ')) : null);
  return {
    bezeichnung: g(e.bezeichnung),
    strasse: g(e.strasse),
    plz: n(e.plz),
    ort: g(e.ort),
    auftraggeber_id: e.auftraggeberId || null,
    notiz: n(e.notiz),
  };
}

export async function legeAdresseAn(e: AdressEntwurf): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase.from('adressbuch').insert(toRow(e));
  if (error) return { ok: false, fehler: error.message };
  resetAdressbuchCache();
  return { ok: true };
}

export async function aktualisiereAdresse(
  id: string, e: AdressEntwurf,
): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase.from('adressbuch').update(toRow(e)).eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  resetAdressbuchCache();
  return { ok: true };
}

export async function loescheAdresse(id: string): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase.from('adressbuch').delete().eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  resetAdressbuchCache();
  return { ok: true };
}
