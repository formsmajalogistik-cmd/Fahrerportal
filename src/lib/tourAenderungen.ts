// Änderungen, die Auftraggeber an ihren Touren vorgenommen haben
// (Migration 079).
//
// Geschrieben wird ausschließlich serverseitig von der SECURITY-DEFINER-
// RPC `ag_tour_aktualisieren` — hier liegt nur das Lesen, Quittieren und
// die Übersetzung der Spaltennamen in verständliche Bezeichnungen.

import { supabase } from './supabase';
import { niederlassungBezeichnung } from './niederlassungen';
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
  // Migration 105 — Rück-Kennzeichen steht im selben Array (Index 1).
  kennzeichen_rueck: 'Kennzeichen Rück',
  verguetung: 'Preis',
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
  plz_start: 'PLZ Start',
  strasse_ziel: 'Straße Ziel',
  plz_ziel: 'PLZ Ziel',
  strasse_rueckfuehrung: 'Straße Rückführung',
  plz_rueckfuehrung: 'PLZ Rückführung',
  auf_eis: 'Terminierung',
  // Migration 089 — Weitergabe an ein eigenes Unterkonto.
  fahrer_id: 'Fahrer',
  auf_eis_notiz: 'Notiz zur Terminierung',
  // Migration 118
  niederlassung_id: 'Niederlassung',
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
export function aenderungSatz(
  feld: string, wertNeu: string | null, wertAlt?: string | null, quelle?: string | null,
): string | null {
  // Aufteilung in zwei AB-Touren (Migration 106): der Server schreibt den
  // fertigen Satz, z.B. „Aufgeteilt aus T-2026-4419 am 08.10.2026".
  // „Keine Auslagen" gesetzt/entfernt (Migration 112): fertiger Satz.
  if (quelle === 'auslagen') return wertNeu ?? '„Keine Auslagen" geändert';
  if (quelle === 'aufteilung') {
    return wertAlt ? `${wertNeu ?? ''} (vorher ${wertAlt})` : (wertNeu ?? 'Aufteilung');
  }
  // Admin-Übernahme beim Verknüpfen eines Protokolls (Migration 105).
  if (quelle === 'verknuepfung') {
    // War das Feld vorher leer, gibt es kein „von".
    const vonNach = wertAlt
      ? `${wertLabel(feld, wertAlt)} → ${wertLabel(feld, wertNeu)}`
      : wertLabel(feld, wertNeu);
    if (feld === 'verguetung') return `Preis ${vonNach} nach km-Übernahme berechnet`;
    return `${feldLabel(feld)} ${vonNach} beim Verknüpfen ${wertAlt ? 'übernommen' : 'eingetragen'}`;
  }
  if (feld === 'auf_eis') {
    return wertNeu === 'ja'
      ? 'Tour auf Eis gelegt (Termin offen)'
      : 'Terminierung aufgehoben';
  }
  // Weitergabe innerhalb einer Fahrer-Konto-Familie (089).
  if (feld === 'fahrer_id') {
    return `Tour weitergegeben: ${wertAlt || '—'} → ${wertNeu || '—'}`;
  }
  return null;
}

/** Datumsfelder im Protokoll als deutsches Datum ausgeben. */
export function wertLabel(feld: string, wert: string | null): string {
  if (feld === 'niederlassung_id') return wert ? (niederlassungBezeichnung(wert) ?? 'andere Niederlassung') : 'Hauptsitz';
  if (wert == null || wert === '') return '—';
  // "ja/nein" bei der Terminierung ist für sich genommen nichtssagend.
  if (feld === 'auf_eis') return wert === 'ja' ? 'auf Eis' : 'terminiert';
  if (feld === 'verguetung') {
    const n = Number(wert);
    if (Number.isFinite(n)) return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }
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
/**
 * Offene (unquittierte) Änderungen, die ANGEZEIGT werden: seit Migration 119
 * nur noch an bestätigten Touren (View tour_aenderungen_offen). Änderungen an
 * noch nicht bestätigten Aufträgen stehen nur im Protokoll der Tour — beim
 * Bestätigen sieht der Admin ohnehin den aktuellen Stand.
 * Ohne Migration 119 (View fehlt): Verhalten wie bisher.
 */
let viewVorhanden: boolean | null = null;
async function offeneAbfrage<T>(baue: (quelle: 'tour_aenderungen') => PromiseLike<{ data: T | null; error: { message: string } | null; count?: number | null }>) {
  if (viewVorhanden !== false) {
    // Die View hat dieselben Spalten wie die Tabelle.
    const r = await baue('tour_aenderungen_offen' as 'tour_aenderungen');
    if (!r.error) { viewVorhanden = true; return r; }
    if (viewVorhanden === true) return r;
    console.warn('[tourAenderungen] Migration 119 nicht erkannt — Anzeige wie bisher:', r.error.message);
    viewVorhanden = false;
  }
  return baue('tour_aenderungen');
}

/** Zahl der anzuzeigenden offenen Änderungen (Zähler am Menüpunkt). */
export async function zaehleOffeneAenderungen(): Promise<number> {
  const r = await offeneAbfrage((quelle) => supabase.from(quelle)
    .select('id', { count: 'exact', head: true })
    .is('gesehen_am', null));
  return r.error ? 0 : (r.count ?? 0);
}

export async function ladeOffeneAenderungen(): Promise<AenderungsGruppe[]> {
  const { data, error } = await offeneAbfrage((quelle) => supabase
    .from(quelle)
    .select('*')
    .is('gesehen_am', null)
    .order('geaendert_am', { ascending: false }));
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
  const { data, error } = await offeneAbfrage((quelle) => supabase
    .from(quelle)
    .select('tour_id')
    .is('gesehen_am', null));
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

/** Alle Einträge einer Tour, neueste zuerst — für das Änderungsprotokoll in der Tour. */
export async function ladeTourAenderungen(tourId: string): Promise<TourAenderung[]> {
  const { data, error } = await supabase
    .from('tour_aenderungen')
    .select('*')
    .eq('tour_id', tourId)
    .order('geaendert_am', { ascending: false })
    .limit(200);
  if (error) {
    console.warn('[tourAenderungen] Laden fehlgeschlagen', error.message);
    return [];
  }
  return (data as TourAenderung[]) ?? [];
}

/**
 * Hält Admin-Übernahmen beim Verknüpfen im Änderungsprotokoll fest
 * (Migration 105). Direkt als gesehen markiert — sonst erschiene die
 * eigene Änderung als „vom Auftraggeber geändert".
 * Wirft bei Fehler; der Aufrufer entscheidet, ob er das meldet.
 */
export async function protokolliereVerknuepfung(
  tourId: string,
  eintraege: Array<{ feld: string; alt: string | null; neu: string | null }>,
): Promise<void> {
  if (eintraege.length === 0) return;
  // Lokale Sitzung — kein Netz-Aufruf; app_users.id = auth.uid().
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  const jetzt = new Date().toISOString();
  const { error } = await supabase.from('tour_aenderungen').insert(eintraege.map((e) => ({
    tour_id: tourId,
    geaendert_von: userId,
    feld: e.feld,
    wert_alt: e.alt,
    wert_neu: e.neu,
    quelle: 'verknuepfung',
    gesehen_am: jetzt,
    gesehen_von: userId,
  })));
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

/** Ergebnis von {@link tourBestaetigen}. */
export type BestaetigenErgebnis =
  | { ok: true }
  | { ok: false; geaendert: Array<{ feld: string; alt: string | null; neu: string | null }>; fehler?: undefined }
  | { ok: false; fehler: string; geaendert?: undefined };

/**
 * Auftrag (Auftraggeber-Einreichung) bestätigen — mit Versionsprüfung
 * (Migration 119): `stand` ist touren.updated_at, wie es beim Laden
 * angezeigt wurde. Hat der Auftraggeber seither etwas geändert, bestätigt
 * der Server NICHT und liefert die geänderten Felder zurück.
 * Ohne Migration 119: einfaches Setzen wie bisher.
 */
export async function tourBestaetigen(tourId: string, stand: string | null | undefined): Promise<BestaetigenErgebnis> {
  const { data, error } = await supabase.rpc('tour_bestaetigen', { p_tour_id: tourId, p_stand: stand ?? null });
  if (error) {
    const fehlt = /tour_bestaetigen|PGRST202|Could not find the function/i.test(`${error.code ?? ''} ${error.message}`);
    if (!fehlt) return { ok: false, fehler: error.message };
    console.warn('[tourBestaetigen] Migration 119 nicht erkannt — ohne Versionsprüfung bestätigt.');
    const { error: e2 } = await supabase.from('touren').update({ bestaetigt: true }).eq('id', tourId);
    return e2 ? { ok: false, fehler: e2.message } : { ok: true };
  }
  const r = (data ?? {}) as { ok?: boolean; grund?: string; fehler?: string; aenderungen?: Array<{ feld: string; alt: string | null; neu: string | null }> };
  if (r.ok) return { ok: true };
  if (r.grund === 'geaendert') {
    // Pro Feld nur die letzte Änderung (alt = Stand beim Laden, neu = jetzt).
    const jeFeld = new Map<string, { feld: string; alt: string | null; neu: string | null }>();
    for (const a of r.aenderungen ?? []) {
      const v = jeFeld.get(a.feld);
      jeFeld.set(a.feld, { feld: a.feld, alt: v ? v.alt : a.alt, neu: a.neu });
    }
    return { ok: false, geaendert: [...jeFeld.values()] };
  }
  return { ok: false, fehler: r.fehler ?? 'Bestätigen fehlgeschlagen.' };
}

/** Hinweistext, wenn der Auftraggeber zwischen Laden und Bestätigen geändert hat. */
export const BESTAETIGEN_GEAENDERT_TEXT = 'Der Auftraggeber hat den Auftrag soeben geändert — nicht bestätigt. Bitte den neuen Stand prüfen und erneut bestätigen.';
