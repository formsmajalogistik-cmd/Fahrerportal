// Datenzugriff für Gutschriften / Rechnungskorrekturen (Migration 078).
//
// Bewusst schlanker als das Rechnungsmodul: keine Zahlungsverfolgung,
// nur die Status 'entwurf' und 'final'. Positionen, Summenlogik und
// PDF-Layout kommen aus dem Rechnungsmodul — hier liegt nur, was
// wirklich Gutschrift-spezifisch ist.

import { supabase } from './supabase';
import { berechneSummenProUst } from './rechnungsformat';
import type { Database, Json } from '../types/supabase';
import type { EditorPosition } from '../pages/admin/rechnungen/positionUtils';

export type Gutschrift = Database['public']['Tables']['gutschriften']['Row'];
export type GutschriftStatus = Gutschrift['status'];
export type GutschriftsPosition =
  Database['public']['Tables']['gutschriftspositionen']['Row'];

export const GUTSCHRIFT_STATUS_LABEL: Record<GutschriftStatus, string> = {
  entwurf: 'Entwurf',
  final: 'Final',
};

/** Empfänger-Adresse, wie sie fest auf der Gutschrift steht. */
export interface AdressSnapshot {
  firma: string | null;
  ansprechpartner: string | null;
  strasse: string | null;
  plz_ort: string | null;
  land: string | null;
}

export const LEERER_SNAPSHOT: AdressSnapshot = {
  firma: null, ansprechpartner: null, strasse: null, plz_ort: null, land: null,
};

export function parseAdressSnapshot(raw: unknown): AdressSnapshot {
  if (!raw || typeof raw !== 'object') return { ...LEERER_SNAPSHOT };
  const o = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    firma: s(o.firma),
    ansprechpartner: s(o.ansprechpartner),
    strasse: s(o.strasse),
    plz_ort: s(o.plz_ort),
    land: s(o.land),
  };
}

export function hatAdresse(a: AdressSnapshot): boolean {
  return !!(a.firma || a.strasse || a.plz_ort);
}

/**
 * `unterzeilen` liegt bei Gutschriften als jsonb vor (bei Rechnungen als
 * text[]). Beide Wege liefern hier eine saubere String-Liste.
 */
export function parseUnterzeilen(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/** DB-Zeile → Editor-Zeile mit stabilem React-Key (= echte UUID). */
export function toEditorPosition(p: GutschriftsPosition): EditorPosition {
  return {
    key: p.id,
    bezeichnung: p.bezeichnung,
    unterzeilen: parseUnterzeilen(p.unterzeilen),
    menge: Number(p.menge),
    einzelpreis: Number(p.einzelpreis),
    gesamtpreis: Number(p.gesamtpreis),
    tour_id: p.tour_id,
    // Gutschriftspositionen kennen keinen zusatz_id-Bezug — die
    // Editor-Zeile teilt sich den Typ mit den Rechnungspositionen.
    zusatz_id: null,
    ist_manuell: p.ist_manuell,
    ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
  };
}

export async function ladeGutschriftPositionen(
  gutschriftId: string,
): Promise<EditorPosition[]> {
  const { data, error } = await supabase
    .from('gutschriftspositionen')
    .select('*')
    .eq('gutschrift_id', gutschriftId)
    .order('position_nr', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as GutschriftsPosition[]).map(toEditorPosition);
}

/**
 * Schreibt die Positionen neu (delete + insert, wie im Rechnungs-Detail)
 * und aktualisiert die Summen auf der Gutschrift. `position_nr` kommt
 * aus dem Index — die Reihenfolge im Editor ist maßgeblich.
 */
export async function speichereGutschriftPositionen(
  gutschriftId: string,
  positionen: EditorPosition[],
  ustSatz: number,
): Promise<{ netto: number; ust: number; brutto: number }> {
  const { error: delErr } = await supabase
    .from('gutschriftspositionen').delete().eq('gutschrift_id', gutschriftId);
  if (delErr) throw new Error(delErr.message);

  if (positionen.length > 0) {
    const rows = positionen.map((p, idx) => ({
      gutschrift_id: gutschriftId,
      position_nr: idx + 1,
      bezeichnung: p.bezeichnung,
      unterzeilen: p.unterzeilen as unknown as Json,
      menge: p.menge,
      einzelpreis: p.einzelpreis,
      gesamtpreis: p.gesamtpreis,
      ust_satz: p.ust_satz,
      tour_id: p.tour_id,
      ist_manuell: p.ist_manuell,
    }));
    const { error: insErr } = await supabase.from('gutschriftspositionen').insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  const sum = berechneSummenProUst(positionen, ustSatz);
  const { error: uErr } = await supabase
    .from('gutschriften')
    .update({
      netto_summe: sum.netto,
      ust_summe: sum.ust,
      brutto_summe: sum.brutto,
    })
    .eq('id', gutschriftId);
  if (uErr) throw new Error(uErr.message);
  return sum;
}

/**
 * Nächste freie Nummer für das Jahr — dieselbe serverseitige Vergabe wie
 * beim Insert-Trigger, damit der Erstellen-Dialog sie vorzeigen kann.
 * Der Admin darf sie überschreiben; bei leerem Feld übernimmt der
 * Trigger. Fehler sind unkritisch — dann bleibt das Feld leer.
 */
export async function naechsteGutschriftNr(jahr: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_gutschrift_nr', { p_year: jahr });
  if (error) {
    console.warn('[gutschriften] next_gutschrift_nr fehlgeschlagen', error.message);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

/** Dateiname für PDF/Anhang: `{Dokumentbezeichnung}_{GS-Nr}.pdf`. */
export function gutschriftPdfFilename(
  dokumentbezeichnung: string, gutschriftNr: string,
): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${safe(dokumentbezeichnung)}_${safe(gutschriftNr)}.pdf`;
}

/** OneDrive-Ablage analog zu den Rechnungen: nach Jahr sortiert. */
export function gutschriftPdfPath(datum: string | null, filename: string): string {
  const jahr = (datum ?? '').slice(0, 4) || String(new Date().getFullYear());
  return `Maja-Logistik/Gutschriften/${jahr}/${filename}`;
}
