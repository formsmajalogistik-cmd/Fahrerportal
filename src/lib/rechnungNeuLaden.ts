// „Touren erneut laden" in einer bestehenden Rechnung.
//
// Vorher wurden die Touren über Auftraggeber + Enddatum im gespeicherten
// Leistungszeitraum gesucht. Das fand je nach Rechnung andere Touren als
// die auf der Rechnung (z.B. wenn der Leistungszeitraum beim Anlegen auf
// das Rechnungsdatum gefallen war oder sich ein Enddatum geändert hatte)
// und zog fremde Touren desselben Zeitraums mit hinein. Jetzt: genau die
// Touren, die in den Positionen stehen — über ihre IDs, unabhängig von
// jedem Datum. Rechnungsdatum und -nummer fasst das Neuladen nicht an.

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

export function bilanzText(b: NeuLadenBilanz, nichtGefunden: number): string {
  const teile: string[] = [];
  if (b.aktualisiert > 0) teile.push(`${b.aktualisiert} Position${b.aktualisiert === 1 ? '' : 'en'} aktualisiert: ${b.felder.join(', ')}`);
  if (b.neu > 0) teile.push(`${b.neu} neu`);
  if (b.entfernt > 0) teile.push(`${b.entfernt} entfernt`);
  if (teile.length === 0) teile.push('Keine Änderungen — die Positionen entsprechen dem aktuellen Stand der Touren');
  let text = `${teile.join(' · ')}.`;
  if (nichtGefunden > 0) text += ` ${nichtGefunden} Tour${nichtGefunden === 1 ? '' : 'en'} nicht mehr gefunden — deren Positionen bleiben unverändert.`;
  return text;
}
