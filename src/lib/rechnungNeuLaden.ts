// „Touren erneut laden" in einer bestehenden Rechnung — zwei Schritte:
//
//  1. Vorhandene Positionen aktualisieren: die Touren der Positionen über
//     ihre IDs, unabhängig von jedem Datum.
//  2. Neue passende Touren hinzufügen (z.B. für eine provisorisch leer
//     angelegte Rechnung): gleicher Auftraggeber (und ggf. derselbe
//     Rechnungsempfänger), effektives Rechnungsdatum der Tour (abweichendes
//     Rechnungsdatum, sonst Enddatum) am Rechnungsdatum der Rechnung bzw.
//     in ihrem Leistungszeitraum — wie beim Anlegen einer Rechnung. Touren,
//     die schon auf einer anderen Rechnung gleicher Art stehen, nicht.
//
// Früher (bis Prompt 116) wurde nur nach Enddatum im GESPEICHERTEN
// Leistungszeitraum gesucht. Bei einer leer angelegten Rechnung ist der der
// Anlagetag und ändert sich beim späteren Ändern des Rechnungsdatums nicht
// mit — deshalb klappte es nur, wenn am selben Tag angelegt und gefüllt
// wurde. Jetzt zählt bei einer Rechnung ohne Touren das AKTUELLE
// Rechnungsdatum. Rechnungsdatum und -nummer fasst das Neuladen nicht an.

import { supabase } from './supabase';
import {
  generatePositionenFromTouren, type Rechnungsformat, type TourForRechnung, type TourenartReal,
} from './rechnungsformat';

export interface PositionFuerNeuLaden {
  bezeichnung: string;
  unterzeilen: string[];
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
  tour_id: string | null;
  zusatz_id: string | null;
  ist_manuell: boolean;
  ust_satz: number | null;
}

const TOUR_SELECT = `
  id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
  startdatum, enddatum, tourenart, kennzeichen,
  kundenname, fin, fin_rueck, km_hin, km_rueck, km_gesamt, sondervereinbarung, verguetung, info,
  zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz, kennzeichen)
`;

type RawTour = Omit<TourForRechnung, 'kennzeichen' | 'tourenart'> & {
  tourenart: TourenartReal; kennzeichen: string[] | null;
};

/** Touren über ihre IDs laden (in Blöcken, URL-Länge). */
export async function ladeTourenPerId(ids: string[]): Promise<TourForRechnung[]> {
  const eindeutig = [...new Set(ids.filter(Boolean))];
  const out: TourForRechnung[] = [];
  for (let i = 0; i < eindeutig.length; i += 100) {
    const { data, error } = await supabase.from('touren').select(TOUR_SELECT).in('id', eindeutig.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const t of (data as unknown as RawTour[]) ?? []) {
      out.push({ ...t, kennzeichen: t.kennzeichen ?? [], zusaetze: t.zusaetze ?? [] });
    }
  }
  return out;
}

export interface NeueTourenSuche {
  touren: TourForRechnung[];
  /** Für die Meldung: „Arval, Rechnungstag 01.10.2026". */
  beschreibung: string;
  /** Gefunden, aber schon auf einer anderen Rechnung. */
  aufAndererRechnung: number;
}

const dm = (iso: string) => iso.split('-').reverse().join('.');

/** Suchzeitraum: ohne Touren nur das Rechnungsdatum, sonst Leistungszeitraum + Rechnungsdatum. */
export function suchZeitraum(r: { datum: string; leistungszeitraum_von: string | null; leistungszeitraum_bis: string | null }, hatTouren: boolean): { von: string; bis: string } {
  if (!hatTouren || !r.leistungszeitraum_von || !r.leistungszeitraum_bis) return { von: r.datum, bis: r.datum };
  return {
    von: r.leistungszeitraum_von < r.datum ? r.leistungszeitraum_von : r.datum,
    bis: r.leistungszeitraum_bis > r.datum ? r.leistungszeitraum_bis : r.datum,
  };
}

/** Neue passende Touren für eine Rechnung (siehe Kopf, Schritt 2). */
export async function sucheNeueTouren(args: {
  rechnungId: string;
  auftraggeberId: string;
  auftraggeberName: string;
  rechnungsempfaengerId: string | null;
  /**
   * Niederlassung der Rechnung (Migration 118): null = Hauptsitz → nur
   * Touren OHNE Niederlassung; undefined = kein Filter (alte Datenbank,
   * manuelle Rechnung). Touren eines anderen Standorts landen so nie auf
   * dieser Rechnung.
   */
  niederlassungId?: string | null;
  /** Anzeige des Standorts für die Meldung („Bremen"). */
  standort?: string | null;
  istAuslagen: boolean;
  zeitraum: { von: string; bis: string };
  vorhandeneTourIds: string[];
}): Promise<NeueTourenSuche> {
  const { von, bis } = args.zeitraum;
  const or = `and(rechnungsdatum_abweichend.eq.true,rechnungsdatum.gte.${von},rechnungsdatum.lte.${bis}),`
    + `and(rechnungsdatum_abweichend.eq.false,enddatum.gte.${von},enddatum.lte.${bis}),`
    + `and(rechnungsdatum_abweichend.is.null,enddatum.gte.${von},enddatum.lte.${bis})`;
  const kandidaten: RawTour[] = [];
  for (let seite = 0; ; seite += 1) {
    let q = supabase.from('touren').select(TOUR_SELECT).eq('auftraggeber_id', args.auftraggeberId);
    if (args.rechnungsempfaengerId) q = q.eq('kontakt_id', args.rechnungsempfaengerId);
    if (args.niederlassungId !== undefined) {
      q = args.niederlassungId ? q.eq('niederlassung_id', args.niederlassungId) : q.is('niederlassung_id', null);
    }
    const { data, error } = await q.or(or).order('enddatum', { ascending: true }).order('id').range(seite * 1000, seite * 1000 + 999);
    if (error) throw new Error(error.message);
    kandidaten.push(...((data as unknown as RawTour[]) ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const vorhanden = new Set(args.vorhandeneTourIds);
  const neu = kandidaten.filter((t) => !vorhanden.has(t.id));
  // Schon auf einer anderen Rechnung gleicher Art (normal / Auslagen)?
  const belegt = new Set<string>();
  for (let i = 0; i < neu.length; i += 100) {
    const { data, error } = await supabase.from('rechnungspositionen')
      .select('tour_id, rechnung:rechnung_id (id, ist_auslagen_rechnung, status)')
      .in('tour_id', neu.slice(i, i + 100).map((t) => t.id));
    if (error) throw new Error(error.message);
    type P = { tour_id: string | null; rechnung: { id: string; ist_auslagen_rechnung: boolean; status?: string } | null };
    for (const p of (data as unknown as P[]) ?? []) {
      // Stornierte Rechnungen belegen keine Tour mehr.
      if (p.tour_id && p.rechnung && p.rechnung.status !== 'storniert' && p.rechnung.id !== args.rechnungId && !!p.rechnung.ist_auslagen_rechnung === args.istAuslagen) belegt.add(p.tour_id);
    }
  }
  const frei = neu.filter((t) => !belegt.has(t.id)).map((t) => ({ ...t, kennzeichen: t.kennzeichen ?? [], zusaetze: t.zusaetze ?? [] }));
  return {
    touren: frei,
    beschreibung: `${args.auftraggeberName}${args.standort ? ` · ${args.standort}` : ''}, ${von === bis ? `Rechnungstag ${dm(von)}` : `Zeitraum ${dm(von)} – ${dm(bis)}`}`,
    aufAndererRechnung: neu.filter((t) => belegt.has(t.id)).length,
  };
}

/** Welche Positionsart hat diese Rechnung beim Anlegen bekommen? */
export function modusFuerRechnung(istAuslagen: boolean, format: Rechnungsformat): 'auslagen' | 'touren' | 'beides' {
  if (istAuslagen) return 'auslagen';
  return format.getrennte_auslagen_rechnung ? 'touren' : 'beides';
}

/**
 * Neue Positionsliste: Positionen der gefundenen Touren frisch erzeugt;
 * Positionen ohne Tour bzw. zu einer nicht mehr vorhandenen Tour bleiben
 * wie sie sind; manuelle Positionen optional erhalten.
 */
export function positionenNeuAufbauen<P extends PositionFuerNeuLaden>(
  alt: P[],
  touren: TourForRechnung[],
  format: Rechnungsformat,
  modus: 'auslagen' | 'touren' | 'beides',
  manuelleBehalten: boolean,
): { positionen: PositionFuerNeuLaden[]; behalten: P[] } {
  const gefunden = new Set(touren.map((t) => t.id));
  const erzeugt = generatePositionenFromTouren(touren, format, { modus });
  const behalten = alt.filter((p) => !p.ist_manuell && (!p.tour_id || !gefunden.has(p.tour_id)));
  const manuell = manuelleBehalten ? alt.filter((p) => p.ist_manuell) : [];
  return { positionen: [...erzeugt, ...behalten, ...manuell], behalten: [...behalten, ...manuell] };
}

export interface NeuLadenBilanz {
  aktualisiert: number;
  felder: string[];
  neu: number;
  entfernt: number;
  unveraendert: number;
}

const r2 = (n: number) => Math.round(Number(n) * 100) / 100;

/** Was hat sich durch das Neuladen geändert? (nur Tour-Positionen) */
export function neuLadenBilanz(
  alt: PositionFuerNeuLaden[],
  neu: PositionFuerNeuLaden[],
  touren: TourForRechnung[],
): NeuLadenBilanz {
  const schluessel = (p: PositionFuerNeuLaden) => `${p.tour_id}|${p.zusatz_id ?? ''}`;
  const tourPos = (l: PositionFuerNeuLaden[]) => l.filter((p) => !p.ist_manuell && p.tour_id);
  const altMap = new Map<string, PositionFuerNeuLaden[]>();
  for (const p of tourPos(alt)) altMap.set(schluessel(p), [...(altMap.get(schluessel(p)) ?? []), p]);
  const kz = new Map(touren.map((t) => [t.id, t.kennzeichen.filter(Boolean)]));
  const felder = new Set<string>();
  let aktualisiert = 0; let neuCount = 0; let unveraendert = 0;
  for (const n of tourPos(neu)) {
    const liste = altMap.get(schluessel(n));
    const a = liste?.shift();
    if (!a) { neuCount++; continue; }
    const f: string[] = [];
    const textAlt = [a.bezeichnung, ...a.unterzeilen].join('\n');
    const textNeu = [n.bezeichnung, ...n.unterzeilen].join('\n');
    if (textAlt !== textNeu) {
      const kzNeu = (kz.get(n.tour_id!) ?? []).some((k) => textNeu.includes(k) && !textAlt.includes(k));
      f.push(kzNeu ? 'Kennzeichen' : 'Text');
    }
    if (r2(a.menge) !== r2(n.menge)) f.push('Menge');
    if (r2(a.einzelpreis) !== r2(n.einzelpreis) || r2(a.gesamtpreis) !== r2(n.gesamtpreis)) f.push('Preis');
    if (f.length) { aktualisiert++; f.forEach((x) => felder.add(x)); } else unveraendert++;
  }
  const gefunden = new Set(touren.map((t) => t.id));
  let entfernt = 0;
  for (const rest of altMap.values()) {
    // Übrig gebliebene alte Positionen einer gefundenen Tour gibt es nicht mehr
    // (z.B. Zusatz gelöscht). Positionen nicht gefundener Touren bleiben stehen.
    entfernt += rest.filter((p) => gefunden.has(p.tour_id!)).length;
  }
  const reihenfolge = ['Kennzeichen', 'Text', 'Menge', 'Preis'];
  return { aktualisiert, felder: reihenfolge.filter((x) => felder.has(x)), neu: neuCount, entfernt, unveraendert };
}

export function bilanzText(b: NeuLadenBilanz, nichtGefunden: number, hinzu?: { touren: number; suche: string; aufAndererRechnung: number }): string {
  const teile: string[] = [];
  if (hinzu && hinzu.touren > 0) teile.push(`${hinzu.touren} ${hinzu.touren === 1 ? 'Tour' : 'Touren'} hinzugefügt`);
  if (b.aktualisiert > 0) teile.push(`${b.aktualisiert} Position${b.aktualisiert === 1 ? '' : 'en'} aktualisiert: ${b.felder.join(', ')}`);
  if (b.neu > 0) teile.push(`${b.neu} neu`);
  if (b.entfernt > 0) teile.push(`${b.entfernt} entfernt`);
  if (teile.length === 0) {
    teile.push(hinzu
      ? `Keine passenden neuen Touren gefunden (gesucht: ${hinzu.suche}${hinzu.aufAndererRechnung ? `; ${hinzu.aufAndererRechnung} ${hinzu.aufAndererRechnung === 1 ? 'steht' : 'stehen'} schon auf einer anderen Rechnung` : ''})`
        + (b.aktualisiert + b.neu + b.entfernt === 0 && b.unveraendert > 0 ? ' · vorhandene Positionen unverändert' : '')
      : 'Keine Änderungen — die Positionen entsprechen dem aktuellen Stand der Touren');
  }
  let text = `${teile.join(' · ')}.`;
  if (nichtGefunden > 0) text += ` ${nichtGefunden} Tour${nichtGefunden === 1 ? '' : 'en'} nicht mehr gefunden — deren Positionen bleiben unverändert.`;
  return text;
}
