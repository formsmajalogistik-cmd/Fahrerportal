// Zuordnung Straße → PLZ → Ort (Migration 097).
//
// Nach dem Zerlegen der Gesamtadressen steht im Vorschlags-Pool nur noch
// die reine Straße. Das ist richtig — aber damit wusste niemand mehr,
// welche PLZ und welcher Ort dazugehören. Diese Tabelle merkt sich das
// und macht aus der Auswahl einer Straße wieder eine vollständige
// Adresse.
//
// Abgrenzung: Das Adressbuch (090) pflegt der Admin von Hand, mit
// Bezeichnung und Auftraggeber-Zuordnung. Hier entsteht alles
// automatisch aus dem, was tatsächlich eingetragen wird.
//
// Sichtbarkeit erzwingt die RLS: Auftraggeber sehen nichts davon,
// Test-Konten lesen mit, schreiben aber nicht (RPC).

import { supabase } from './supabase';
import { vergleichsSchluessel } from './textNormalisierung';
import type { Database } from '../types/supabase';

export type AdressKombination =
  Database['public']['Tables']['adress_kombinationen']['Row'];

/** Eine vollständige Adresse, wie sie gemeldet bzw. ausgewählt wird. */
export interface KombiEntwurf {
  strasse: string;
  plz: string;
  ort: string;
}

const t = (v: string | null | undefined): string => (v ?? '').trim();

/** Anzeigezeile: „Werner-Haas-Straße 1 — 74172 Neckarsulm". */
export function kombiZeile(k: Pick<AdressKombination, 'strasse' | 'plz' | 'ort'>): string {
  const ortszeile = [t(k.plz), t(k.ort)].filter(Boolean).join(' ');
  return ortszeile ? `${t(k.strasse)} — ${ortszeile}` : t(k.strasse);
}

// ---------------------------------------------------------------
// Lesen — pro Session einmal, wie beim Vorschlags-Pool.
// ---------------------------------------------------------------
let cache: Promise<AdressKombination[]> | null = null;

export async function ladeKombinationen(): Promise<AdressKombination[]> {
  if (cache) return await cache;
  cache = (async () => {
    const { data, error } = await supabase
      .from('adress_kombinationen')
      .select('*')
      // Im Eingabe-Dropdown zählt Relevanz, nicht das Alphabet:
      // häufigste zuerst, bei Gleichstand die zuletzt genutzte.
      .order('anzahl', { ascending: false, nullsFirst: false })
      .order('letzte_nutzung', { ascending: false, nullsFirst: false })
      .limit(2000);
    if (error) {
      // Auftraggeber bekommen hier per RLS schlicht nichts — kein Fehler.
      console.warn('[adressKombinationen] Laden fehlgeschlagen', error.message);
      return [];
    }
    return (data as AdressKombination[]) ?? [];
  })();
  return await cache;
}

export function resetKombinationenCache(): void {
  cache = null;
}

/**
 * Alle Kombinationen für die Pflegeansicht — seitenweise, damit der
 * Server nicht bei seiner Zeilen-Obergrenze abschneidet (dieselbe Falle
 * wie beim Pool).
 */
export async function ladeAlleKombinationen(): Promise<AdressKombination[]> {
  const SEITE = 1000;
  const out: AdressKombination[] = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await supabase
      .from('adress_kombinationen')
      .select('*')
      .order('strasse', { ascending: true })
      .order('plz', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(von, von + SEITE - 1);
    if (error) throw new Error(error.message);
    const seite = (data as AdressKombination[]) ?? [];
    out.push(...seite);
    if (seite.length < SEITE) break;
  }
  return out;
}

// ---------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------

/**
 * Vollständige Adressen melden. Unvollständige (ohne PLZ oder Ort)
 * werden übersprungen — sie tragen nichts bei, was der Pool nicht schon
 * hätte. Dieselbe Regel steckt in der RPC (097).
 *
 * Fehler sind unkritisch: Formular bzw. Tour sind zu diesem Zeitpunkt
 * bereits gespeichert.
 */
export async function merkeKombinationen(
  kombis: KombiEntwurf[], istTest: boolean,
): Promise<void> {
  if (istTest) return;
  const gesehen = new Set<string>();
  const nutzbar: KombiEntwurf[] = [];
  for (const k of kombis) {
    const strasse = t(k.strasse);
    const plz = t(k.plz);
    const ort = t(k.ort);
    if (!strasse || !plz || !ort) continue;
    const key = `${vergleichsSchluessel(strasse)}|${plz}|${vergleichsSchluessel(ort)}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    nutzbar.push({ strasse, plz, ort });
  }
  if (nutzbar.length === 0) return;
  try {
    const { error } = await supabase.rpc('adress_kombination_merken', {
      p_kombis: nutzbar as unknown as Database['public']['Functions']['adress_kombination_merken']['Args']['p_kombis'],
    });
    if (error) {
      console.warn('[adressKombinationen] Merken fehlgeschlagen', error.message);
      return;
    }
    resetKombinationenCache();
  } catch (err) {
    console.warn('[adressKombinationen] Merken warf', err);
  }
}

export async function aktualisiereKombination(
  id: string, e: KombiEntwurf,
): Promise<{ ok: boolean; fehler?: string }> {
  const strasse = t(e.strasse);
  if (!strasse) return { ok: false, fehler: 'Die Straße darf nicht leer sein.' };
  const { error } = await supabase
    .from('adress_kombinationen')
    .update({ strasse, plz: t(e.plz) || null, ort: t(e.ort) || null })
    .eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  resetKombinationenCache();
  return { ok: true };
}

export async function loescheKombinationen(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let geloescht = 0;
  // In Blöcken, damit weder URL-Länge noch Laufzeit zum Problem werden.
  for (let i = 0; i < ids.length; i += 200) {
    const block = ids.slice(i, i + 200);
    const { error } = await supabase
      .from('adress_kombinationen').delete().in('id', block);
    if (error) throw new Error(error.message);
    geloescht += block.length;
  }
  resetKombinationenCache();
  return geloescht;
}
