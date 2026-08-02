// Ansprechpartner je Station einer Tour (Migration 080).
//
// Die Tabelle `tour_ansprechpartner` ist die Quelle der Wahrheit. Die
// alten jsonb-Spalten touren.kontakt_start/_ziel/_rueckfuehrung bleiben
// bestehen und werden per DB-Trigger als Spiegel des jeweils ERSTEN
// Ansprechpartners fortgeschrieben — bestehende PDF-Mappings, Exporte
// und Anzeigen lesen also unverändert weiter von dort.
//
// Schreibrechte: Admins direkt (RLS), Auftraggeber ausschließlich über
// die RPC `ag_tour_ansprechpartner_setzen`.

import { supabase } from './supabase';
import type { Database, Json } from '../types/supabase';

export type Station = 'start' | 'ziel' | 'rueckfuehrung';
export type TourAnsprechpartnerRow =
  Database['public']['Tables']['tour_ansprechpartner']['Row'];

export const STATIONEN: Station[] = ['start', 'ziel', 'rueckfuehrung'];

export const STATION_LABEL: Record<Station, string> = {
  start: 'Start',
  ziel: 'Ziel',
  rueckfuehrung: 'Rückführung',
};

/** Editor-Zeile mit stabilem Key — NIE der Array-Index (siehe Positions-Bug). */
export interface KontaktEntwurf {
  key: string;
  name: string;
  telefon: string;
  email: string;
}

let keySeq = 0;
export function neuerKontaktKey(): string {
  keySeq += 1;
  return `kontakt-${Date.now().toString(36)}-${keySeq}`;
}

export function leererKontakt(): KontaktEntwurf {
  return { key: neuerKontaktKey(), name: '', telefon: '', email: '' };
}

export function istLeer(k: KontaktEntwurf): boolean {
  return !k.name.trim() && !k.telefon.trim() && !k.email.trim();
}

/** Kontakte je Station, wie sie der Editor braucht (immer min. ein Block). */
export type KontaktMap = Record<Station, KontaktEntwurf[]>;

export function leereKontaktMap(): KontaktMap {
  return {
    start: [leererKontakt()],
    ziel: [leererKontakt()],
    rueckfuehrung: [leererKontakt()],
  };
}

/**
 * Lädt alle Ansprechpartner einer Tour, gruppiert nach Station. Stationen
 * ohne Eintrag bekommen einen leeren Block, damit der Editor immer ein
 * Formular anzeigt (Standardansicht = ein Ansprechpartner).
 */
export async function ladeAnsprechpartner(tourId: string): Promise<KontaktMap> {
  const map = leereKontaktMap();
  const { data, error } = await supabase
    .from('tour_ansprechpartner')
    .select('*')
    .eq('tour_id', tourId)
    .order('sortierung', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[tourAnsprechpartner] Laden fehlgeschlagen', error.message);
    return map;
  }
  const rows = (data as TourAnsprechpartnerRow[]) ?? [];
  for (const st of STATIONEN) {
    const eigene = rows.filter((r) => r.station === st);
    map[st] = eigene.length > 0
      ? eigene.map((r) => ({
          key: r.id,
          name: r.name ?? '',
          telefon: r.telefon ?? '',
          email: r.email ?? '',
        }))
      : [leererKontakt()];
  }
  return map;
}

/** Für die RPC / den Insert: leere Blöcke raus, getrimmt. */
export function toPayload(liste: KontaktEntwurf[]): Array<{
  name: string; telefon: string; email: string;
}> {
  return liste
    .filter((k) => !istLeer(k))
    .map((k) => ({
      name: k.name.trim(),
      telefon: k.telefon.trim(),
      email: k.email.trim(),
    }));
}

/**
 * Admin-Weg: schreibt die Liste einer Station neu (delete + insert).
 * Der DB-Trigger spiegelt den ersten Eintrag danach in kontakt_*.
 */
export async function speichereAnsprechpartner(
  tourId: string, station: Station, liste: KontaktEntwurf[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('tour_ansprechpartner')
    .delete()
    .eq('tour_id', tourId)
    .eq('station', station);
  if (delErr) throw new Error(delErr.message);

  const rows = toPayload(liste).map((k, idx) => ({
    tour_id: tourId,
    station,
    name: k.name || null,
    telefon: k.telefon || null,
    email: k.email || null,
    sortierung: idx,
  }));
  if (rows.length === 0) return;
  const { error: insErr } = await supabase.from('tour_ansprechpartner').insert(rows);
  if (insErr) throw new Error(insErr.message);
}

/** Alle drei Stationen auf einmal (Speichern im Tour-Dialog). */
export async function speichereAlleAnsprechpartner(
  tourId: string, map: KontaktMap,
): Promise<void> {
  for (const st of STATIONEN) {
    await speichereAnsprechpartner(tourId, st, map[st]);
  }
}

export interface AgKontaktErgebnis {
  ok: boolean;
  fehler?: string | null;
  geaendert?: boolean;
  bestaetigt?: boolean;
}

/**
 * Auftraggeber-Weg: läuft über die SECURITY-DEFINER-RPC, die Eigentum,
 * Ablehnung und Abrechnungsstatus prüft und die Änderung protokolliert.
 */
export async function speichereAgAnsprechpartner(
  tourId: string, station: Station, liste: KontaktEntwurf[],
): Promise<AgKontaktErgebnis> {
  const { data, error } = await supabase.rpc('ag_tour_ansprechpartner_setzen', {
    p_tour_id: tourId,
    p_station: station,
    p_liste: toPayload(liste) as unknown as Json,
  });
  if (error) return { ok: false, fehler: error.message };
  return (data as unknown as AgKontaktErgebnis) ?? { ok: false, fehler: 'Keine Antwort vom Server.' };
}

// ---- Zeitfelder ---------------------------------------------------

/**
 * `time`-Spalten kommen als "HH:MM:SS" zurück; das <input type="time">
 * erwartet "HH:MM". Leere Eingabe → null, damit die Spalte leer bleibt
 * statt auf 00:00 zu springen.
 */
export function zeitZuInput(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{2}):(\d{2})/.exec(v);
  return m ? `${m[1]}:${m[2]}` : '';
}

export function inputZuZeit(v: string): string | null {
  const t = v.trim();
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}

/** Anzeige "08:00" bzw. leer — für Karten und Listen. */
export function zeitAnzeige(v: string | null | undefined): string {
  return zeitZuInput(v);
}

/**
 * Datum + optionale Uhrzeit + optionaler Freitext-Hinweis zu einer
 * dezenten Zeile zusammenfassen: "29.07.2026, 08:00 (vormittags)".
 * Liefert nur das Datum zurück, wenn nichts weiter gepflegt ist.
 */
export function datumMitZeit(
  datumFormatiert: string,
  zeit: string | null | undefined,
  hinweis: string | null | undefined,
): string {
  const z = zeitAnzeige(zeit);
  const h = (hinweis ?? '').trim();
  let out = datumFormatiert;
  if (z) out += `, ${z}`;
  if (h) out += out === datumFormatiert ? ` (${h})` : ` (${h})`;
  return out;
}
