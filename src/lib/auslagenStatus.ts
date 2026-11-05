// Auslagen-Status je Tour und Kennzeichen, Auslagen-Prüfung vor dem
// Erstellen/Versenden einer Rechnung — damit keine Auslagen vergessen werden.
//
// Begriffe (Migration 113):
//   * abrechenbarer Zusatz — jeder Zusatz außer „Keine Auslagen"; er gehört
//     auf eine Rechnung (abgerechnet = Rechnungsposition mit zusatz_id).
//     Ausnahme: Rechnungsformat „Zusätze: keine" (ohne getrennte
//     Auslagen-Rechnung) — dort gelten Zusätze mit der Tour als erledigt.
//   * Auslage — abrechenbarer Zusatz, dessen Art als Auslage zählt
//     (zusatz_arten; Maut, Wartezeit, Rote Kennzeichen, Reifenhandling,
//     Wäsche zählen nicht).
//   * „Keine Auslagen" — eigene Zusatz-Art je Kennzeichen.
//
// Je Kennzeichen (AB: eins; ABA/ABC: Hin und Rück) ist der Auslagen-Status
// geklärt, wenn eine Auslage oder „Keine Auslagen" für dieses Kennzeichen
// vorhanden ist. Ein Zusatz ohne Kennzeichen (oder mit einem Kennzeichen,
// das zu keinem der Tour passt) gilt für alle Kennzeichen der Tour.
//
// Status (berechnet, nicht gespeichert):
//   offen            — mindestens ein abrechenbarer Zusatz auf keiner Rechnung
//   ungeklaert       — mindestens ein Kennzeichen ungeklärt
//   abgerechnet      — alle abrechenbaren Zusätze auf einer Rechnung
//   keine            — nur „Keine Auslagen"
//   ohne_abgerechnet — ungeklärt, aber schon abgerechnet (Altbestand bzw.
//                      bei „Auslagen separat" eine Auslagenrechnung danach)
// `ungeklaertMelden` sagt, ob „ungeklärt" in Hinweisen auftauchen soll.

import { supabase } from './supabase';
import { inStuecken, ladeInBloecken } from './ladeInBloecken';
import { parseRechnungsformat, type ZusaetzeDarstellung } from './rechnungsformat';
import { fahrzeugWertGleich } from './fahrzeugAbgleich';
import {
  KEINE_AUSLAGEN, istKeineAuslagen, ladeZusatzArten, zaehltAlsAuslage, type ZusatzArten,
} from './zusatzArten';

export interface AuslagenZusatz {
  id: string; kategorie: string; anzahl?: number | null; betrag?: number | null; kennzeichen?: string | null;
}

export interface AuslagenTour {
  id: string;
  tour_nr: string | null;
  auftraggeber_id: string | null;
  startdatum: string | null;
  enddatum: string | null;
  tourenart?: string | null;
  kennzeichen: string[];
  zusaetze: AuslagenZusatz[];
  start_stadt?: string | null;
  ziel_stadt?: string | null;
  rueckfuehrung_stadt?: string | null;
}

export interface RechnungRef { id: string; nr: string; istAuslagen: boolean; datum: string }

export interface AbrechnungsStand {
  zusatzRechnungen: Map<string, RechnungRef[]>;
  tourRechnungen: Map<string, RechnungRef[]>;
  /** Je Auftraggeber: Datum der jüngsten Auslagenrechnung. */
  letzteAuslagenRechnung: Map<string, string>;
}

export interface AgAuslagenFormat { getrennt: boolean; darstellung: ZusaetzeDarstellung }

export const FORMAT_STANDARD: AgAuslagenFormat = { getrennt: false, darstellung: 'einzeln' };

export type AuslagenStatusArt = 'keine' | 'offen' | 'abgerechnet' | 'ungeklaert' | 'ohne_abgerechnet';

export interface Slot { rolle: 'einzig' | 'hin' | 'rueck'; kennzeichen: string | null }

export interface AuslagenStatus {
  art: AuslagenStatusArt;
  /** Abrechenbare Zusätze, die auf keiner Rechnung stehen. */
  offen: AuslagenZusatz[];
  /** true, wenn alle offenen Zusätze Auslagen sind („Auslagen offen"). */
  offenNurAuslagen: boolean;
  nummern: string[];
  ungeklaert: Slot[];
  ungeklaertMelden: boolean;
}

export function leererStand(): AbrechnungsStand {
  return { zusatzRechnungen: new Map(), tourRechnungen: new Map(), letzteAuslagenRechnung: new Map() };
}

const eindeutig = (l: string[]) => [...new Set(l)];
const kzText = (k: string | null | undefined) => (k ?? '').trim() || null;

// ---- Kennzeichen ------------------------------------------------------------

export function slotsDerTour(t: Pick<AuslagenTour, 'tourenart' | 'kennzeichen'>): Slot[] {
  if (t.tourenart === 'ABA' || t.tourenart === 'ABC') {
    return [{ rolle: 'hin', kennzeichen: kzText(t.kennzeichen[0]) }, { rolle: 'rueck', kennzeichen: kzText(t.kennzeichen[1]) }];
  }
  return [{ rolle: 'einzig', kennzeichen: kzText(t.kennzeichen[0]) }];
}

/** „Rück-Kennzeichen HH-AB 1234" bzw. „Kennzeichen HB-AB 1". */
export function slotLabel(s: Slot): string {
  const was = s.rolle === 'hin' ? 'Hin-Kennzeichen' : s.rolle === 'rueck' ? 'Rück-Kennzeichen' : 'Kennzeichen';
  return s.kennzeichen ? `${was} ${s.kennzeichen}` : `${was} (nicht erfasst)`;
}

/** Kurzform für Badges: „Rück HH-AB 1234". */
export function slotKurz(s: Slot): string {
  const was = s.rolle === 'hin' ? 'Hin' : s.rolle === 'rueck' ? 'Rück' : '';
  return [was, s.kennzeichen ?? (was ? '—' : '')].filter(Boolean).join(' ');
}

/** Gilt ein Zusatz für dieses Kennzeichen? */
export function zusatzGiltFuer(zKennzeichen: string | null | undefined, slot: Slot, slots: Slot[]): boolean {
  const zk = kzText(zKennzeichen);
  if (!zk || !slot.kennzeichen) return true;
  if (fahrzeugWertGleich(zk, slot.kennzeichen)) return true;
  // Kennzeichen passt zu keinem der Tour (z.B. später geändert) → für alle.
  return !slots.some((s) => s.kennzeichen && fahrzeugWertGleich(zk, s.kennzeichen));
}

export function ungeklaerteSlots(t: AuslagenTour, arten: ZusatzArten): Slot[] {
  const slots = slotsDerTour(t);
  const klaerend = t.zusaetze.filter((z) => istKeineAuslagen(z.kategorie) || zaehltAlsAuslage(z.kategorie, arten));
  return slots.filter((s) => !klaerend.some((z) => zusatzGiltFuer(z.kennzeichen, s, slots)));
}

/** Abrechenbare Zusätze (alles außer „Keine Auslagen"). */
export function abrechenbareZusaetze<Z extends { kategorie: string }>(zusaetze: Z[]): Z[] {
  return zusaetze.filter((z) => !istKeineAuslagen(z.kategorie));
}

/**
 * Darf dieser Zusatz so angelegt werden? Liefert einen Hinweis bei Konflikt:
 *   * „Keine Auslagen" für ein Kennzeichen, das schon eine Auslage oder
 *     „Keine Auslagen" hat
 *   * streng (Posteingang): Auslage für ein Kennzeichen mit „Keine
 *     Auslagen" — erst auflösen. Ohne streng entfernt die Datenbank den
 *     „Keine Auslagen"-Eintrag selbst (Migration 113).
 */
export function konfliktBeimHinzufuegen(
  t: Pick<AuslagenTour, 'tourenart' | 'kennzeichen' | 'zusaetze'>,
  neu: { kategorie: string; kennzeichen: string | null },
  arten: ZusatzArten,
  streng = false,
): string | null {
  const slots = slotsDerTour(t);
  const betroffen = slots.filter((s) => zusatzGiltFuer(neu.kennzeichen, s, slots));
  if (istKeineAuslagen(neu.kategorie)) {
    for (const s of betroffen) {
      const andere = t.zusaetze.filter((z) => zusatzGiltFuer(z.kennzeichen, s, slots));
      const auslage = andere.find((z) => zaehltAlsAuslage(z.kategorie, arten));
      if (auslage) return `${slotLabel(s)} hat bereits eine Auslage (${auslage.kategorie}) — „Keine Auslagen" passt nicht dazu.`;
      if (andere.some((z) => istKeineAuslagen(z.kategorie))) return `Für ${slotLabel(s)} ist „Keine Auslagen" bereits eingetragen.`;
    }
    return null;
  }
  if (streng && zaehltAlsAuslage(neu.kategorie, arten)) {
    for (const s of betroffen) {
      if (t.zusaetze.some((z) => istKeineAuslagen(z.kategorie) && zusatzGiltFuer(z.kennzeichen, s, slots))) {
        return `Für ${slotLabel(s)} ist „Keine Auslagen" eingetragen. Bitte zuerst entfernen (✕) oder die Auslage einem anderen Kennzeichen zuordnen.`;
      }
    }
  }
  return null;
}

// ---- Status -----------------------------------------------------------------

/** Zusätze werden bei diesem Format bewusst nicht als Positionen gestellt. */
function zusaetzeOhnePositionen(fmt: AgAuslagenFormat): boolean {
  return !fmt.getrennt && fmt.darstellung === 'keine';
}

export function auslagenStatus(t: AuslagenTour, stand: AbrechnungsStand, fmt: AgAuslagenFormat, arten: ZusatzArten): AuslagenStatus {
  const tourRe = stand.tourRechnungen.get(t.id) ?? [];
  const normal = tourRe.filter((r) => !r.istAuslagen);
  const abr = abrechenbareZusaetze(t.zusaetze);
  const ohnePos = zusaetzeOhnePositionen(fmt);
  const offen = abr.filter((z) => !(stand.zusatzRechnungen.get(z.id)?.length) && !(ohnePos && normal.length > 0));
  const ungeklaert = ungeklaerteSlots(t, arten);

  // „Ungeklärt" melden? Altbestand (schon abgerechnet) nicht; bei
  // „Auslagen separat" erst, wenn die Tour auf der normalen Rechnung steht
  // und danach noch keine Auslagenrechnung kam.
  let melden: boolean;
  if (!fmt.getrennt) melden = tourRe.length === 0;
  else if (tourRe.some((r) => r.istAuslagen) || normal.length === 0) melden = false;
  else {
    const normalDatum = normal.reduce((m, r) => (r.datum > m ? r.datum : m), '');
    const la = t.auftraggeber_id ? stand.letzteAuslagenRechnung.get(t.auftraggeber_id) : undefined;
    melden = !(la && la >= normalDatum);
  }

  const nummern = eindeutig(ohnePos
    ? normal.map((r) => r.nr)
    : abr.flatMap((z) => (stand.zusatzRechnungen.get(z.id) ?? []).map((r) => r.nr)));
  let art: AuslagenStatusArt;
  if (offen.length > 0) art = 'offen';
  else if (ungeklaert.length > 0 && (melden || tourRe.length === 0)) art = 'ungeklaert';
  else if (abr.length > 0) art = 'abgerechnet';
  else if (ungeklaert.length > 0) art = 'ohne_abgerechnet';
  else art = 'keine';
  return {
    art, offen, offenNurAuslagen: offen.every((z) => zaehltAlsAuslage(z.kategorie, arten)),
    nummern: art === 'ohne_abgerechnet' ? eindeutig(tourRe.map((r) => r.nr)) : nummern,
    ungeklaert, ungeklaertMelden: ungeklaert.length > 0 && melden,
  };
}

export function ungeklaertText(slots: Slot[]): string {
  const detail = slots.filter((s) => s.rolle !== 'einzig').map(slotKurz);
  return detail.length ? `Auslagen ungeklärt (${detail.join(', ')})` : 'Auslagen ungeklärt';
}

export function statusText(s: AuslagenStatus): string {
  switch (s.art) {
    case 'keine': return 'Keine Auslagen';
    case 'offen': return `${s.offenNurAuslagen ? 'Auslagen' : 'Zusätze'} offen (${s.offen.length})`;
    case 'abgerechnet': return `Auslagen auf ${s.nummern.join(', ')}`;
    case 'ungeklaert': return ungeklaertText(s.ungeklaert);
    case 'ohne_abgerechnet': return 'ohne Auslagen abgerechnet';
  }
}

// ---- Prüfung bei der Rechnungserstellung --------------------------------

export interface Auffaelligkeit {
  tour: AuslagenTour;
  grund: 'ungeklaert' | 'fehlen';
  fehlend: AuslagenZusatz[];
  /** Ungeklärte Kennzeichen (grund 'ungeklaert'). */
  slots: Slot[];
}

/**
 * Was fällt bei den Auslagen einer Rechnung auf?
 *   * normale Rechnung, Auftraggeber ohne „Auslagen separat": jede Tour —
 *     Kennzeichen ungeklärt bzw. abrechenbare Zusätze weder auf dieser
 *     noch auf einer anderen Rechnung
 *   * normale Rechnung, Auftraggeber mit „Auslagen separat": nichts
 *   * Auslagenrechnung: alle übergebenen Touren (Rechnungstag)
 * „Keine Auslagen" ist nie abrechenbar und fehlt deshalb nie.
 */
export function pruefeRechnungAuslagen(args: {
  art: 'normal' | 'auslagen';
  fmt: AgAuslagenFormat;
  touren: AuslagenTour[];
  positionen: Array<{ tour_id: string | null; zusatz_id: string | null }>;
  stand: AbrechnungsStand;
  arten: ZusatzArten;
  eigeneRechnungIds?: string[];
}): Auffaelligkeit[] {
  const { art, fmt, touren, positionen, stand, arten } = args;
  if (art === 'normal' && fmt.getrennt) return [];
  const eigene = new Set(args.eigeneRechnungIds ?? []);
  const hier = new Set(positionen.map((p) => p.zusatz_id).filter(Boolean) as string[]);
  const anderswo = (z: AuslagenZusatz) => (stand.zusatzRechnungen.get(z.id) ?? []).some((r) => !eigene.has(r.id));
  const out: Auffaelligkeit[] = [];
  const gesehen = new Set<string>();
  for (const t of touren) {
    if (gesehen.has(t.id)) continue;
    gesehen.add(t.id);
    const slots = ungeklaerteSlots(t, arten);
    if (slots.length > 0) out.push({ tour: t, grund: 'ungeklaert', fehlend: [], slots });
    if (art === 'normal' && zusaetzeOhnePositionen(fmt)) continue;
    const fehlend = abrechenbareZusaetze(t.zusaetze).filter((z) => !hier.has(z.id) && !anderswo(z));
    if (fehlend.length > 0) out.push({ tour: t, grund: 'fehlen', fehlend, slots: [] });
  }
  return out;
}

// ---- Prüfergebnis je Tour und Kennzeichen (für den Prüfdialog) -----------

export interface KennzeichenZeile {
  slot: Slot;
  /** ok = Auslage vorhanden, keine = „Keine Auslagen", ungeklaert. */
  status: 'ok' | 'keine' | 'ungeklaert';
}

export interface TourPruefung {
  tour: AuslagenTour;
  zeilen: KennzeichenZeile[];
  /** Abrechenbare Zusätze weder auf dieser noch auf einer anderen Rechnung. */
  fehlend: AuslagenZusatz[];
  problem: boolean;
}

export interface PruefErgebnis {
  /** Alle geprüften Touren, nach Tourdatum sortiert. */
  touren: TourPruefung[];
  geprueft: number;
  offen: number;
}

export function kennzeichenZeilen(t: AuslagenTour, arten: ZusatzArten): KennzeichenZeile[] {
  const slots = slotsDerTour(t);
  return slots.map((slot) => {
    const fuer = t.zusaetze.filter((z) => zusatzGiltFuer(z.kennzeichen, slot, slots));
    const status = fuer.some((z) => zaehltAlsAuslage(z.kategorie, arten)) ? 'ok'
      : fuer.some((z) => istKeineAuslagen(z.kategorie)) ? 'keine' : 'ungeklaert';
    return { slot, status };
  });
}

/**
 * Prüfung einer Rechnung, je Tour gruppiert (Regeln wie
 * pruefeRechnungAuslagen). Liefert ALLE geprüften Touren, damit der Dialog
 * nach einer Aktion erledigte Zeilen als ✓ zeigen kann.
 */
export function pruefeRechnung(args: Parameters<typeof pruefeRechnungAuslagen>[0]): PruefErgebnis {
  const { art, fmt, touren, positionen, stand, arten } = args;
  const eindeutig = [...new Map(touren.map((t) => [t.id, t])).values()]
    .sort((a, b) => (a.enddatum ?? a.startdatum ?? '').localeCompare(b.enddatum ?? b.startdatum ?? '') || (a.tour_nr ?? '').localeCompare(b.tour_nr ?? ''));
  if (art === 'normal' && fmt.getrennt) {
    return { touren: eindeutig.map((t) => ({ tour: t, zeilen: [], fehlend: [], problem: false })), geprueft: eindeutig.length, offen: 0 };
  }
  const eigene = new Set(args.eigeneRechnungIds ?? []);
  const hier = new Set(positionen.map((p) => p.zusatz_id).filter(Boolean) as string[]);
  const anderswo = (z: AuslagenZusatz) => (stand.zusatzRechnungen.get(z.id) ?? []).some((r) => !eigene.has(r.id));
  const ohnePos = art === 'normal' && zusaetzeOhnePositionen(fmt);
  const out = eindeutig.map((t) => {
    const zeilen = kennzeichenZeilen(t, arten);
    const fehlend = ohnePos ? [] : abrechenbareZusaetze(t.zusaetze).filter((z) => !hier.has(z.id) && !anderswo(z));
    return { tour: t, zeilen, fehlend, problem: fehlend.length > 0 || zeilen.some((z) => z.status === 'ungeklaert') };
  });
  return { touren: out, geprueft: out.length, offen: out.filter((x) => x.problem).length };
}

export function auffaelligkeitText(a: Auffaelligkeit): string {
  if (a.grund === 'ungeklaert') {
    return `${a.slots.map(slotLabel).join(', ')}: Auslagen ungeklärt — keine Auslage und kein „Keine Auslagen"`;
  }
  const n = a.fehlend.length;
  return `${n} ${n === 1 ? 'Zusatz steht' : 'Zusätze stehen'} nicht auf der Rechnung: ${a.fehlend.map((z) => z.kategorie).join(', ')}`;
}

export function pruefZusammenfassung(l: Auffaelligkeit[]): string {
  const u = l.filter((a) => a.grund === 'ungeklaert').length;
  const f = l.filter((a) => a.grund === 'fehlen');
  const teile: string[] = [];
  if (u > 0) teile.push(`${u} ${u === 1 ? 'Tour' : 'Touren'} mit ungeklärten Auslagen (keine Auslage, kein „Keine Auslagen") — bitte prüfen`);
  for (const a of f) teile.push(`Tour ${a.tour.tour_nr ?? ''} hat ${a.fehlend.length} ${a.fehlend.length === 1 ? 'Zusatz, der' : 'Zusätze, die'} nicht auf der Rechnung ${a.fehlend.length === 1 ? 'steht' : 'stehen'}`);
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

/** Abrechnungsstand für Touren: Positionen und Auslagenrechnungen. */
export async function ladeAbrechnungsStand(tourIds: string[]): Promise<AbrechnungsStand> {
  const stand = leererStand();
  const ids = [...new Set(tourIds.filter(Boolean))];
  const teile = await Promise.all(inStuecken(ids, 150).map((stueck) =>
    ladeInBloecken((v, b) => supabase.from('rechnungspositionen').select(POS_SELECT).in('tour_id', stueck).order('id').range(v, b))));
  for (const p of teile) {
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

const TOUR_SELECT = 'id, tour_id, auftraggeber_id, startdatum, enddatum, tourenart, kennzeichen, start_stadt, ziel_stadt, rueckfuehrung_stadt, zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, kennzeichen)';
type RawTour = {
  id: string; tour_id: string | null; auftraggeber_id: string | null; startdatum: string | null; enddatum: string | null;
  tourenart: string | null; kennzeichen: string[] | null; zusaetze: AuslagenZusatz[] | null;
  start_stadt: string | null; ziel_stadt: string | null; rueckfuehrung_stadt: string | null;
};
const mapTour = (t: RawTour): AuslagenTour => ({
  id: t.id, tour_nr: t.tour_id, auftraggeber_id: t.auftraggeber_id, startdatum: t.startdatum, enddatum: t.enddatum,
  tourenart: t.tourenart, kennzeichen: t.kennzeichen ?? [], zusaetze: t.zusaetze ?? [],
  start_stadt: t.start_stadt, ziel_stadt: t.ziel_stadt, rueckfuehrung_stadt: t.rueckfuehrung_stadt,
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

/**
 * Zusatz „Keine Auslagen" je Kennzeichen anlegen (anzahl 1, betrag 0).
 * `herkunft` 'leerfahrt' (Migration 114): automatisch durch die Leerfahrt —
 * „Leerfahrt entfernen" nimmt genau diese Einträge wieder weg.
 */
export async function keineAuslagenAnlegen(
  eintraege: Array<{ tourId: string; kennzeichen: string | null }>,
  herkunft?: 'leerfahrt',
): Promise<number> {
  if (eintraege.length === 0) return 0;
  const { error } = await supabase.from('tour_zusaetze').insert(eintraege.map((e) => ({
    tour_id: e.tourId, kategorie: KEINE_AUSLAGEN, anzahl: 1, betrag: 0, kennzeichen: e.kennzeichen, notiz: null,
    ...(herkunft ? { herkunft } : {}),
  })));
  if (error) throw new Error(error.message);
  return eintraege.length;
}

/**
 * Schnellaktion „Keine Auslagen": legt für alle noch ungeklärten
 * Kennzeichen der Touren einen Zusatz an. Kennzeichen mit einer Auslage
 * (oder schon „Keine Auslagen") bekommen nichts.
 */
export async function keineAuslagenFuerUngeklaerte(tourIds: string[], nurKennzeichen?: Slot, herkunft?: 'leerfahrt'): Promise<number> {
  const [touren, arten] = await Promise.all([ladeAuslagenTouren(tourIds), ladeZusatzArten()]);
  const eintraege = touren.flatMap((t) => {
    const slots = ungeklaerteSlots(t, arten)
      .filter((s) => !nurKennzeichen || (s.rolle === nurKennzeichen.rolle && s.kennzeichen === nurKennzeichen.kennzeichen));
    // Ohne erfasste Kennzeichen genügt EIN Eintrag auf Tour-Ebene (ohne
    // Kennzeichen gilt er für alle) — nicht je Rolle doppelt.
    const gesehen = new Set<string>();
    return slots.filter((s) => {
      const k = s.kennzeichen ?? '';
      if (gesehen.has(k)) return false;
      gesehen.add(k);
      return true;
    }).map((s) => ({ tourId: t.id, kennzeichen: s.kennzeichen }));
  });
  return keineAuslagenAnlegen(eintraege, herkunft);
}
