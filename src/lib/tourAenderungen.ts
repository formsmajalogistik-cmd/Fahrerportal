// Änderungen, die Auftraggeber an ihren Touren vorgenommen haben
// (Migration 079).
//
// Geschrieben wird ausschließlich serverseitig von der SECURITY-DEFINER-
// RPC `ag_tour_aktualisieren` — hier liegt nur das Lesen, Quittieren und
// die Übersetzung der Spaltennamen in verständliche Bezeichnungen.

import { supabase } from './supabase';
import type { Database } from '../types/supabase';

export type TourAenderung = Database['public']['Tables']['tour_aenderungen']['Row'];

/** Spaltenname → Anzeigename. Unbekannte Felder fallen auf die Spalte zurück. */
const FELD_LABEL: Record<string, string> = {
  start_stadt: 'Start-Stadt',
  ziel_stadt: 'Ziel-Stadt',
  rueckfuehrung_stadt: 'Rückführung-Stadt',
  adresse_start: 'Adresse Start',
  adresse_ziel: 'Adresse Ziel',
  adresse_rueckfuehrung: 'Adresse Rückführung',
  kontakt_start: 'Kontakt Start',
  kontakt_ziel: 'Kontakt Ziel',
  kontakt_rueckfuehrung: 'Kontakt Rückführung',
  kennzeichen: 'Kennzeichen',
  fin: 'FIN',
  fin_rueck: 'FIN Rückführung',
  kundenname: 'Kundenname',
  startdatum: 'Startdatum',
  enddatum: 'Enddatum',
  tourenart: 'Tourenart',
  ist_e_fahrzeug: 'E-Fahrzeug',
  info: 'Hinweise',
  // Migration 080
  fahrzeugmodell: 'Fahrzeugmodell',
  fahrzeugmodell_rueck: 'Fahrzeugmodell Rück',
  zeit_start: 'Zeit Start (Abholung)',
  zeit_ziel: 'Zeit Ziel (Abgabe)',
  zeit_rueckfuehrung: 'Zeit Rückführung',
  km_hin: 'km Hin',
  km_rueck: 'km Rück',
  km_gesamt: 'km gesamt',
  // Migration 086
  strasse_start: 'Straße Start',
  hausnummer_start: 'Hausnummer Start',
  plz_start: 'PLZ Start',
  strasse_ziel: 'Straße Ziel',
  hausnummer_ziel: 'Hausnummer Ziel',
  plz_ziel: 'PLZ Ziel',
  strasse_rueckfuehrung: 'Straße Rückführung',
  hausnummer_rueckfuehrung: 'Hausnummer Rückführung',
  plz_rueckfuehrung: 'PLZ Rückführung',
  auf_eis: 'Terminierung',
  auf_eis_notiz: 'Notiz zur Terminierung',
  ansprechpartner_start: 'Ansprechpartner Start',
  ansprechpartner_ziel: 'Ansprechpartner Ziel',
  ansprechpartner_rueckfuehrung: 'Ansprechpartner Rückführung',
};

export function feldLabel(feld: string): string {
  return FELD_LABEL[feld] ?? feld;
}

/**
 * Ganze Änderungszeile in Klartext, wo "nein → ja" nichts sagt.
 * Gibt null zurück, wenn die normale Feld/Alt/Neu-Darstellung reicht.
 */
export function aenderungSatz(feld: string, wertNeu: string | null): string | null {
  if (feld !== 'auf_eis') return null;
  return wertNeu === 'ja'
    ? 'Tour auf Eis gelegt (Termin offen)'
    : 'Terminierung aufgehoben';
}

/** Datumsfelder im Protokoll als deutsches Datum ausgeben. */
export function wertLabel(feld: string, wert: string | null): string {
  if (wert == null || wert === '') return '—';
  // "ja/nein" bei der Terminierung ist für sich genommen nichtssagend.
  if (feld === 'auf_eis') return wert === 'ja' ? 'auf Eis' : 'terminiert';
  if (feld === 'startdatum' || feld === 'enddatum') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(wert);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return wert;
}

/** Eine Tour mit allen zugehörigen unquittierten Änderungen. */
export interface AenderungsGruppe {
  tour_id: string;
  tour_nr: string | null;
  route: string;
  bestaetigt: boolean;
  geaendert_am: string;
  geaendert_von: string | null;
  eintraege: TourAenderung[];
}

interface TourLite {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  bestaetigt: boolean;
}

/**
 * Lädt alle unquittierten Änderungen und gruppiert sie pro Tour —
 * inklusive Route und Bestätigungs-Status für die Anzeige. Admin-only
 * (RLS); für alle anderen Rollen kommt eine leere Liste zurück.
 */
export async function ladeOffeneAenderungen(): Promise<AenderungsGruppe[]> {
  const { data, error } = await supabase
    .from('tour_aenderungen')
    .select('*')
    .is('gesehen_am', null)
    .order('geaendert_am', { ascending: false });
  if (error) {
    console.warn('[tourAenderungen] Laden fehlgeschlagen', error.message);
    return [];
  }
  const rows = (data as TourAenderung[]) ?? [];
  if (rows.length === 0) return [];

  const tourIds = Array.from(new Set(rows.map((r) => r.tour_id)));
  const { data: touren } = await supabase
    .from('touren')
    .select('id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt, bestaetigt')
    .in('id', tourIds);
  const byId = new Map<string, TourLite>();
  for (const t of ((touren as unknown as TourLite[]) ?? [])) byId.set(t.id, t);

  const gruppen = new Map<string, AenderungsGruppe>();
  for (const r of rows) {
    const vorhanden = gruppen.get(r.tour_id);
    if (vorhanden) {
      vorhanden.eintraege.push(r);
      // Neuestes Änderungsdatum der Gruppe behalten.
      if (r.geaendert_am > vorhanden.geaendert_am) {
        vorhanden.geaendert_am = r.geaendert_am;
        vorhanden.geaendert_von = r.geaendert_von;
      }
      continue;
    }
    const t = byId.get(r.tour_id);
    gruppen.set(r.tour_id, {
      tour_id: r.tour_id,
      tour_nr: t?.tour_id ?? null,
      route: t
        ? [t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt].filter(Boolean).join(' → ')
        : 'Tour unbekannt',
      bestaetigt: t?.bestaetigt ?? false,
      geaendert_am: r.geaendert_am,
      geaendert_von: r.geaendert_von,
      eintraege: [r],
    });
  }
  // Bestätigte Touren zuerst — dort ist die Änderung am kritischsten.
  return [...gruppen.values()].sort((a, b) => {
    if (a.bestaetigt !== b.bestaetigt) return a.bestaetigt ? -1 : 1;
    return a.geaendert_am < b.geaendert_am ? 1 : -1;
  });
}

/** Nur die Tour-IDs mit offenen Änderungen — für das Karten-Badge. */
export async function ladeGeaenderteTourIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('tour_aenderungen')
    .select('tour_id')
    .is('gesehen_am', null);
  if (error) return new Set();
  return new Set(((data as Array<{ tour_id: string }>) ?? []).map((r) => r.tour_id));
}

/** Quittiert die Änderungen einer oder mehrerer Touren ("Gesehen"). */
export async function quittiereAenderungen(
  tourIds: string[], userId: string | null,
): Promise<void> {
  if (tourIds.length === 0) return;
  const { error } = await supabase
    .from('tour_aenderungen')
    .update({ gesehen_am: new Date().toISOString(), gesehen_von: userId })
    .in('tour_id', tourIds)
    .is('gesehen_am', null);
  if (error) throw new Error(error.message);
}

/** Ergebnis der Update-RPC. */
export interface AgUpdateErgebnis {
  ok: boolean;
  fehler?: string | null;
  bestaetigt?: boolean;
  tour_id?: string | null;
  route?: string | null;
  aenderungen?: Array<{ feld: string; alt: string | null; neu: string | null }>;
}

/**
 * Speichert die Auftraggeber-Änderungen. Welche Felder tatsächlich
 * geschrieben werden, entscheidet AUSSCHLIESSLICH der Server — hier
 * mitgeschickte Zusatzfelder werden dort verworfen.
 */
export async function speichereAgTour(
  tourId: string, daten: Record<string, unknown>,
): Promise<AgUpdateErgebnis> {
  const { data, error } = await supabase.rpc('ag_tour_aktualisieren', {
    p_tour_id: tourId,
    p_daten: daten as never,
  });
  if (error) return { ok: false, fehler: error.message };
  return (data as unknown as AgUpdateErgebnis) ?? { ok: false, fehler: 'Keine Antwort vom Server.' };
}
