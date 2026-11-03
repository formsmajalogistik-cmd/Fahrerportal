// Auslagen-Status je Tour und Auslagen-Prüfung vor dem Erstellen/Versenden
// einer Rechnung — damit keine Auslagen vergessen werden.
//
// „Auslage" heißt hier: ein Zusatz der Tour (tour_zusaetze). Nur Zusätze
// werden auf Rechnungen gestellt; abgerechnet ist ein Zusatz, sobald eine
// Rechnungsposition auf ihn zeigt (rechnungspositionen.zusatz_id). Bei
// Auftraggebern mit Rechnungsformat „Zusätze: keine" (ohne getrennte
// Auslagen-Rechnung) erzeugt die App bewusst keine Zusatz-Positionen —
// dort gelten die Zusätze mit der Tour als erledigt.
//
// Status (berechnet, nicht gespeichert):
//   keine            — „Keine Auslagen" gesetzt, keine Zusätze
//   offen            — Zusätze vorhanden, mindestens einer nicht abgerechnet
//   abgerechnet      — alle Zusätze auf einer Rechnung (Nummern)
//   ungeklaert       — keine Zusätze, keine Markierung
//   ohne_abgerechnet — keine Zusätze, aber schon abgerechnet (Altbestand
//                      bzw. bei „Auslagen separat" eine Auslagenrechnung
//                      danach) → wird NICHT als ungeklärt gemeldet
// `melden` sagt, ob „ungeklärt" in Hinweisen auftauchen soll: bei
// „Auslagen separat" erst, wenn die Tour auf der normalen Rechnung steht.
//
// Die Markierung „Keine Auslagen" (Migration 112) dürfen nur Admins
// lesen/setzen; Fahrer und Auftraggeber sehen sie auch per API nicht.

import { supabase } from './supabase';
import { inStuecken, ladeInBloecken } from './ladeInBloecken';
import { parseRechnungsformat, type ZusaetzeDarstellung } from './rechnungsformat';

export interface AuslagenZusatz { id: string; kategorie: string; anzahl?: number | null; betrag?: number | null }

export interface AuslagenTour {
  id: string;
  tour_nr: string | null;
  auftraggeber_id: string | null;
  startdatum: string | null;
  enddatum: string | null;
  kennzeichen: string[];
  zusaetze: AuslagenZusatz[];
}

export interface RechnungRef { id: string; nr: string; istAuslagen: boolean; datum: string }

export interface AbrechnungsStand {
  /** Touren mit „Keine Auslagen". */
  keine: Set<string>;
  zusatzRechnungen: Map<string, RechnungRef[]>;
  tourRechnungen: Map<string, RechnungRef[]>;
  /** Je Auftraggeber: Datum der jüngsten Auslagenrechnung. */
  letzteAuslagenRechnung: Map<string, string>;
  /** Migration 112 fehlt → keine Markierungen verfügbar. */
  markierungFehlt?: boolean;
}

export interface AgAuslagenFormat { getrennt: boolean; darstellung: ZusaetzeDarstellung }

export const FORMAT_STANDARD: AgAuslagenFormat = { getrennt: false, darstellung: 'einzeln' };

export type AuslagenStatusArt = 'keine' | 'offen' | 'abgerechnet' | 'ungeklaert' | 'ohne_abgerechnet';

export interface AuslagenStatus {
  art: AuslagenStatusArt;
  offen: AuslagenZusatz[];
  nummern: string[];
  melden: boolean;
}

export function leererStand(): AbrechnungsStand {
  return { keine: new Set(), zusatzRechnungen: new Map(), tourRechnungen: new Map(), letzteAuslagenRechnung: new Map() };
}

const eindeutig = (l: string[]) => [...new Set(l)];

/** Zusätze werden bei diesem Format bewusst nicht als Positionen gestellt. */
function zusaetzeOhnePositionen(fmt: AgAuslagenFormat): boolean {
  return !fmt.getrennt && fmt.darstellung === 'keine';
}

export function auslagenStatus(t: AuslagenTour, stand: AbrechnungsStand, fmt: AgAuslagenFormat): AuslagenStatus {
  const tourRe = stand.tourRechnungen.get(t.id) ?? [];
  const normal = tourRe.filter((r) => !r.istAuslagen);
  if (t.zusaetze.length > 0) {
    const ohnePos = zusaetzeOhnePositionen(fmt);
    const offen = t.zusaetze.filter((z) => !(stand.zusatzRechnungen.get(z.id)?.length) && !(ohnePos && normal.length > 0));
    if (offen.length > 0) return { art: 'offen', offen, nummern: [], melden: true };
    const nummern = ohnePos
      ? normal.map((r) => r.nr)
      : t.zusaetze.flatMap((z) => (stand.zusatzRechnungen.get(z.id) ?? []).map((r) => r.nr));
    return { art: 'abgerechnet', offen: [], nummern: eindeutig(nummern), melden: false };
  }
  if (stand.keine.has(t.id)) return { art: 'keine', offen: [], nummern: [], melden: false };
  if (!fmt.getrennt) {
    // Altbestand: schon abgerechnete Touren nicht als „ungeklärt" melden.
    return tourRe.length > 0
      ? { art: 'ohne_abgerechnet', offen: [], nummern: eindeutig(tourRe.map((r) => r.nr)), melden: false }
      : { art: 'ungeklaert', offen: [], nummern: [], melden: true };
  }
  // „Auslagen separat": erst melden, wenn die Tour auf der normalen
  // Rechnung steht und danach noch keine Auslagenrechnung kam.
  if (tourRe.some((r) => r.istAuslagen)) return { art: 'ohne_abgerechnet', offen: [], nummern: eindeutig(tourRe.map((r) => r.nr)), melden: false };
  if (normal.length === 0) return { art: 'ungeklaert', offen: [], nummern: [], melden: false };
  const normalDatum = normal.reduce((m, r) => (r.datum > m ? r.datum : m), '');
  const la = t.auftraggeber_id ? stand.letzteAuslagenRechnung.get(t.auftraggeber_id) : undefined;
  if (la && la >= normalDatum) return { art: 'ohne_abgerechnet', offen: [], nummern: eindeutig(normal.map((r) => r.nr)), melden: false };
  return { art: 'ungeklaert', offen: [], nummern: [], melden: true };
}

export function statusText(s: AuslagenStatus): string {
  switch (s.art) {
    case 'keine': return 'Keine Auslagen';
    case 'offen': return `Auslagen offen (${s.offen.length})`;
    case 'abgerechnet': return `Auslagen auf ${s.nummern.join(', ')}`;
    case 'ungeklaert': return 'Auslagen ungeklärt';
    case 'ohne_abgerechnet': return 'ohne Auslagen abgerechnet';
  }
}

// ---- Prüfung bei der Rechnungserstellung --------------------------------

export interface Auffaelligkeit {
  tour: AuslagenTour;
  grund: 'ungeklaert' | 'fehlen';
  fehlend: AuslagenZusatz[];
}

/**
 * Was fällt bei den Auslagen einer Rechnung auf?
 *   * normale Rechnung, Auftraggeber ohne „Auslagen separat": jede Tour
 *     der Rechnung — ungeklärt bzw. Zusätze weder auf dieser noch auf
 *     einer anderen Rechnung
 *   * normale Rechnung, Auftraggeber mit „Auslagen separat": nichts
 *   * Auslagenrechnung: alle übergebenen Touren (Rechnungstag) —
 *     Zusätze weder hier noch anderswo abgerechnet, ungeklärte Touren
 * „Keine Auslagen" erzeugt nie einen Hinweis.
 */
export function pruefeRechnungAuslagen(args: {
  art: 'normal' | 'auslagen';
  fmt: AgAuslagenFormat;
  touren: AuslagenTour[];
  positionen: Array<{ tour_id: string | null; zusatz_id: string | null }>;
  stand: AbrechnungsStand;
  eigeneRechnungIds?: string[];
}): Auffaelligkeit[] {
  const { art, fmt, touren, positionen, stand } = args;
  if (art === 'normal' && fmt.getrennt) return [];
  const eigene = new Set(args.eigeneRechnungIds ?? []);
  const hier = new Set(positionen.map((p) => p.zusatz_id).filter(Boolean) as string[]);
  const anderswo = (z: AuslagenZusatz) => (stand.zusatzRechnungen.get(z.id) ?? []).some((r) => !eigene.has(r.id));
  const out: Auffaelligkeit[] = [];
  const gesehen = new Set<string>();
  for (const t of touren) {
    if (gesehen.has(t.id)) continue;
    gesehen.add(t.id);
    if (t.zusaetze.length === 0) {
      if (!stand.keine.has(t.id)) out.push({ tour: t, grund: 'ungeklaert', fehlend: [] });
      continue;
    }
    if (art === 'normal' && zusaetzeOhnePositionen(fmt)) continue;
    const fehlend = t.zusaetze.filter((z) => !hier.has(z.id) && !anderswo(z));
    if (fehlend.length > 0) out.push({ tour: t, grund: 'fehlen', fehlend });
  }
  return out;
}

export function auffaelligkeitText(a: Auffaelligkeit): string {
  if (a.grund === 'ungeklaert') return 'Keine Auslagen erfasst und nicht als „Keine Auslagen" markiert — bitte prüfen';
  const n = a.fehlend.length;
  return `${n} ${n === 1 ? 'Auslage steht' : 'Auslagen stehen'} nicht auf der Rechnung: ${a.fehlend.map((z) => z.kategorie).join(', ')}`;
}

export function pruefZusammenfassung(l: Auffaelligkeit[]): string {
  const u = l.filter((a) => a.grund === 'ungeklaert').length;
  const f = l.filter((a) => a.grund === 'fehlen');
  const teile: string[] = [];
  if (u > 0) teile.push(`${u} ${u === 1 ? 'Tour' : 'Touren'} ohne Auslagen und ohne „Keine Auslagen" — bitte prüfen`);
  for (const a of f) teile.push(`Tour ${a.tour.tour_nr ?? ''} hat ${a.fehlend.length} ${a.fehlend.length === 1 ? 'Auslage, die' : 'Auslagen, die'} nicht auf der Rechnung ${a.fehlend.length === 1 ? 'steht' : 'stehen'}`);
  return teile.join(' · ');
}

// ---- Laden / Schreiben ------------------------------------------------------

type PosRow = {
  tour_id: string | null; zusatz_id: string | null;
  rechnung: { id: string; rechnungsnummer: string; ist_auslagen_rechnung: boolean; datum: string } | null;
};

/** Positionen (tour_id, zusatz_id, Rechnung) in den Stand eintragen. */
export function standAusPositionen(stand: AbrechnungsStand, rows: PosRow[]): void {
  const add = (m: Map<string, RechnungRef[]>, key: string, r: RechnungRef) => {
    const l = m.get(key) ?? [];
    if (!l.some((x) => x.id === r.id)) l.push(r);
    m.set(key, l);
  };
  for (const p of rows) {
    if (!p.rechnung) continue;
    const r: RechnungRef = { id: p.rechnung.id, nr: p.rechnung.rechnungsnummer, istAuslagen: !!p.rechnung.ist_auslagen_rechnung, datum: p.rechnung.datum };
    if (p.tour_id) add(stand.tourRechnungen, p.tour_id, r);
    if (p.zusatz_id) add(stand.zusatzRechnungen, p.zusatz_id, r);
  }
}

export const POS_SELECT = 'id, tour_id, zusatz_id, rechnung:rechnung_id (id, rechnungsnummer, ist_auslagen_rechnung, datum)';

/** Abrechnungsstand für Touren: Markierungen, Positionen, Auslagenrechnungen. */
export async function ladeAbrechnungsStand(tourIds: string[]): Promise<AbrechnungsStand> {
  const stand = leererStand();
  const ids = [...new Set(tourIds.filter(Boolean))];
  const teile = await Promise.all(inStuecken(ids, 150).map(async (stueck) => {
    const [k, p] = await Promise.all([
      supabase.from('tour_keine_auslagen').select('tour_id').in('tour_id', stueck),
      ladeInBloecken((v, b) => supabase.from('rechnungspositionen').select(POS_SELECT).in('tour_id', stueck).order('id').range(v, b)),
    ]);
    return { k, p };
  }));
  for (const { k, p } of teile) {
    if (k.error) stand.markierungFehlt = true;
    for (const r of (k.data ?? []) as Array<{ tour_id: string }>) stand.keine.add(r.tour_id);
    if (p.error) throw new Error(p.error);
    standAusPositionen(stand, p.data as unknown as PosRow[]);
  }
  await ladeLetzteAuslagenRechnungen(stand);
  return stand;
}

export async function ladeLetzteAuslagenRechnungen(stand: AbrechnungsStand): Promise<void> {
  const { data } = await ladeInBloecken((v, b) => supabase.from('rechnungen')
    .select('id, auftraggeber_id, datum').eq('ist_auslagen_rechnung', true).order('id').range(v, b));
  for (const r of (data as Array<{ auftraggeber_id: string | null; datum: string }>) ?? []) {
    if (!r.auftraggeber_id) continue;
    const alt = stand.letzteAuslagenRechnung.get(r.auftraggeber_id);
    if (!alt || r.datum > alt) stand.letzteAuslagenRechnung.set(r.auftraggeber_id, r.datum);
  }
}

/** Markierungen nachladen (Tourenliste lädt Positionen selbst). */
export async function ladeKeineAuslagen(tourIds: string[]): Promise<{ keine: Set<string>; fehlt: boolean }> {
  const keine = new Set<string>();
  let fehlt = false;
  for (const stueck of inStuecken([...new Set(tourIds)], 150)) {
    const { data, error } = await supabase.from('tour_keine_auslagen').select('tour_id').in('tour_id', stueck);
    if (error) { fehlt = true; break; }
    for (const r of (data ?? []) as Array<{ tour_id: string }>) keine.add(r.tour_id);
  }
  return { keine, fehlt };
}

export function formatAusRechnungsformat(raw: unknown): AgAuslagenFormat {
  const f = parseRechnungsformat(raw);
  return { getrennt: !!f.getrennte_auslagen_rechnung, darstellung: f.zusaetze_darstellung };
}

export async function ladeAgFormate(agIds: string[]): Promise<Map<string, AgAuslagenFormat>> {
  const m = new Map<string, AgAuslagenFormat>();
  const ids = [...new Set(agIds.filter(Boolean))];
  for (const stueck of inStuecken(ids, 150)) {
    const { data } = await supabase.from('auftraggeber').select('id, rechnungsformat').in('id', stueck);
    for (const a of (data ?? []) as Array<{ id: string; rechnungsformat: unknown }>) m.set(a.id, formatAusRechnungsformat(a.rechnungsformat));
  }
  return m;
}

const TOUR_SELECT = 'id, tour_id, auftraggeber_id, startdatum, enddatum, kennzeichen, zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag)';
type RawTour = { id: string; tour_id: string | null; auftraggeber_id: string | null; startdatum: string | null; enddatum: string | null; kennzeichen: string[] | null; zusaetze: AuslagenZusatz[] | null };
const mapTour = (t: RawTour): AuslagenTour => ({
  id: t.id, tour_nr: t.tour_id, auftraggeber_id: t.auftraggeber_id, startdatum: t.startdatum, enddatum: t.enddatum,
  kennzeichen: (t.kennzeichen ?? []).filter(Boolean), zusaetze: t.zusaetze ?? [],
});

export async function ladeAuslagenTouren(ids: string[]): Promise<AuslagenTour[]> {
  const out: AuslagenTour[] = [];
  for (const stueck of inStuecken([...new Set(ids.filter(Boolean))], 100)) {
    const { data, error } = await supabase.from('touren').select(TOUR_SELECT).in('id', stueck);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as RawTour[]).map(mapTour));
  }
  return out;
}

/** Touren eines Auftraggebers mit effektivem Rechnungsdatum an diesen Tagen. */
export async function ladeTourenZuRechnungstagen(agId: string, tage: string[]): Promise<AuslagenTour[]> {
  const out: AuslagenTour[] = [];
  for (const tag of [...new Set(tage)]) {
    const or = `and(rechnungsdatum_abweichend.eq.true,rechnungsdatum.eq.${tag}),`
      + `and(rechnungsdatum_abweichend.eq.false,enddatum.eq.${tag}),`
      + `and(rechnungsdatum_abweichend.is.null,enddatum.eq.${tag})`;
    const { data, error } = await ladeInBloecken((v, b) => supabase.from('touren').select(TOUR_SELECT)
      .eq('auftraggeber_id', agId).or(or).order('id').range(v, b));
    if (error) throw new Error(error);
    out.push(...((data ?? []) as unknown as RawTour[]).map(mapTour));
  }
  return out;
}

/** Effektives Rechnungsdatum der Touren (für die Auslagenrechnung). */
export async function rechnungstageDerTouren(ids: string[]): Promise<string[]> {
  const tage: string[] = [];
  for (const stueck of inStuecken([...new Set(ids)], 100)) {
    const { data } = await supabase.from('touren').select('enddatum, rechnungsdatum, rechnungsdatum_abweichend').in('id', stueck);
    for (const t of (data ?? []) as Array<{ enddatum: string | null; rechnungsdatum: string | null; rechnungsdatum_abweichend: boolean | null }>) {
      const d = t.rechnungsdatum_abweichend && t.rechnungsdatum ? t.rechnungsdatum : t.enddatum;
      if (d) tage.push(d);
    }
  }
  return [...new Set(tage)];
}

export async function keineAuslagenSetzen(tourIds: string[], an: boolean): Promise<{ geaendert: number; uebersprungen: Array<{ tour_id: string; tour_nr: string | null; grund: string }> }> {
  const { data, error } = await supabase.rpc('tour_keine_auslagen_setzen', { p_tour_ids: tourIds, p_an: an });
  if (error) throw new Error(error.message);
  return data as unknown as { geaendert: number; uebersprungen: Array<{ tour_id: string; tour_nr: string | null; grund: string }> };
}
