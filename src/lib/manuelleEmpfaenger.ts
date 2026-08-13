// Manuelle Rechnungs-/Gutschrift-Empfänger (Migration 088).
//
// Empfänger, die KEIN Auftraggeber sind — Subunternehmer, Fahrer,
// Privatpersonen. Bewusst eine eigene Tabelle: Einträge hier tauchen
// in keiner Auftraggeber-Liste, keinem Auftraggeber-Filter und keinem
// Tour-Dropdown auf.
//
// Die Rechnung selbst speichert immer ihren eigenen Adress-Snapshot;
// dieser Merk-Eintrag ist nur eine Eingabehilfe. Ein gelöschter
// Eintrag verändert deshalb kein ausgestelltes Dokument.

import { supabase } from './supabase';
import type { Database } from '../types/supabase';

export type ManuellerEmpfaenger =
  Database['public']['Tables']['manuelle_empfaenger']['Row'];

/** Sentinel im Auftraggeber-Dropdown für „kein Auftraggeber". */
export const MANUELL_OPTION = '__manuell';

/** Frei eingegebene Empfängerdaten (noch nicht gespeichert). */
export interface ManuellerEmpfaengerEntwurf {
  firma: string;
  /** '', 'Herr' oder 'Frau' — steuert die automatische Brief-Anrede. */
  anrede: string;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  email: string;
  ustId: string;
  kundennummer: string;
}

export function leererEmpfaenger(): ManuellerEmpfaengerEntwurf {
  return {
    firma: '', anrede: '', vorname: '', nachname: '',
    strasse: '', plz: '', ort: '', land: '',
    email: '', ustId: '', kundennummer: '',
  };
}

const t = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Namenszeile des Adressblocks: "Herr Max Mustermann".
 *
 * Genau dieses Format erwartet `buildAnrede()` aus rechnungsformat.ts,
 * um daraus "Sehr geehrter Herr Mustermann," zu machen — die Logik der
 * Rechnungsempfänger wird also wiederverwendet, nicht nachgebaut.
 * Leer, wenn kein Name eingetragen ist (reine Firmenrechnung).
 */
export function nameZeile(e: Partial<ManuellerEmpfaengerEntwurf>): string {
  return [t(e.anrede), t(e.vorname), t(e.nachname)].filter(Boolean).join(' ');
}

/** "12345 Musterstadt" — leere Teile fallen weg. */
export function plzOrt(e: Partial<ManuellerEmpfaengerEntwurf>): string {
  return [t(e.plz), t(e.ort)].filter(Boolean).join(' ');
}

/**
 * Adress-Snapshot, wie ihn Rechnung und Gutschrift speichern.
 * Leere Felder werden zu '' — der PDF-Renderer lässt leere Zeilen weg,
 * eine Privatperson ohne Firma bekommt also keine Leerzeile.
 */
export function snapshotAusEmpfaenger(e: ManuellerEmpfaengerEntwurf): {
  firma: string; ansprechpartner: string; strasse: string;
  plz_ort: string; land: string;
} {
  return {
    firma: t(e.firma),
    ansprechpartner: nameZeile(e),
    strasse: t(e.strasse),
    plz_ort: plzOrt(e),
    land: t(e.land),
  };
}

/** Anzeigename für Listen: Firma, sonst Name. */
export function anzeigeName(e: Partial<ManuellerEmpfaengerEntwurf>): string {
  const name = [t(e.vorname), t(e.nachname)].filter(Boolean).join(' ');
  return t(e.firma) || name || 'Ohne Namen';
}

/**
 * Empfängername einer gespeicherten Rechnung/Gutschrift für die
 * Übersicht — aus dem Snapshot, nicht aus der Merk-Tabelle.
 */
export function empfaengerAusSnapshot(args: {
  firma: string | null;
  ansprechpartner: string | null;
}): string {
  return t(args.firma) || t(args.ansprechpartner) || 'Manueller Empfänger';
}

export function entwurfAusGespeichertem(
  m: ManuellerEmpfaenger,
): ManuellerEmpfaengerEntwurf {
  return {
    firma: m.firma ?? '',
    anrede: m.anrede ?? '',
    vorname: m.vorname ?? '',
    nachname: m.nachname ?? '',
    strasse: m.strasse ?? '',
    plz: m.plz ?? '',
    ort: m.ort ?? '',
    land: m.land ?? '',
    email: m.email ?? '',
    ustId: m.ust_id ?? '',
    kundennummer: m.kundennummer ?? '',
  };
}

// ---------------------------------------------------------------
// Datenzugriff — RLS lässt ausschließlich Admins durch (088).
// ---------------------------------------------------------------

export async function ladeManuelleEmpfaenger(): Promise<ManuellerEmpfaenger[]> {
  const { data, error } = await supabase
    .from('manuelle_empfaenger')
    .select('*')
    .order('firma', { ascending: true, nullsFirst: false })
    .order('nachname', { ascending: true, nullsFirst: false });
  if (error) {
    console.warn('[manuelleEmpfaenger] Laden fehlgeschlagen', error);
    return [];
  }
  return (data as ManuellerEmpfaenger[]) ?? [];
}

function toRow(e: ManuellerEmpfaengerEntwurf) {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  return {
    firma: n(e.firma), anrede: n(e.anrede),
    vorname: n(e.vorname), nachname: n(e.nachname),
    strasse: n(e.strasse), plz: n(e.plz), ort: n(e.ort), land: n(e.land),
    email: n(e.email), ust_id: n(e.ustId), kundennummer: n(e.kundennummer),
  };
}

export async function merkeEmpfaenger(
  e: ManuellerEmpfaengerEntwurf,
): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase.from('manuelle_empfaenger').insert(toRow(e));
  if (error) return { ok: false, fehler: error.message };
  return { ok: true };
}

export async function aktualisiereEmpfaenger(
  id: string, e: ManuellerEmpfaengerEntwurf,
): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase
    .from('manuelle_empfaenger').update(toRow(e)).eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  return { ok: true };
}

export async function loescheEmpfaenger(
  id: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const { error } = await supabase
    .from('manuelle_empfaenger').delete().eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  return { ok: true };
}
