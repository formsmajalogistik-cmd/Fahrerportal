// Gemeinsame Preisberechnung einer Tour — benutzt vom Speichern in der
// Tour-Maske (TourDetailDialog/TourCreateDialog) UND von der km-Übernahme
// beim Verknüpfen eines Protokolls (EingangLinkDialog).
//
// Vorher rechnete nur die Maske: Kamen die km beim Verknüpfen über die
// Routenberechnung auf die Tour, blieben km_gesamt und Preis leer, bis
// jemand die Tour öffnete und speicherte („Kein Preis").

import { abrechnungsKm, computeKmGesamt, fetchTourPriceBreakdown, formatEuro, type TourPriceBreakdown } from './touren';
import type { TourenArt } from '../types/db';

export interface PreisEingabe {
  auftraggeberId: string | null | undefined;
  tourenart: TourenArt | string | null | undefined;
  kmHin: number | null | undefined;
  kmRueck: number | null | undefined;
  hatRueckfuehrung: boolean;
  /** ABA-Ausnahme „Gesamt-km für Rechnung verwenden". */
  abaGesamtKmBerechnen: boolean | null | undefined;
  istEFahrzeug: boolean | null | undefined;
}

/** km_gesamt (Anzeige/Rechnung) und die km für die Preisstufe. */
export function tourKm(e: PreisEingabe): { kmGesamt: number | null; preisKm: number | null } {
  const kmGesamt = computeKmGesamt({
    km_hin: e.kmHin ?? null,
    km_rueck: e.kmRueck ?? null,
    hatRueckfuehrung: e.hatRueckfuehrung,
  });
  const preisKm = abrechnungsKm({
    tourenart: e.tourenart || 'AB',
    km_hin: e.kmHin ?? null,
    km_gesamt: kmGesamt,
    abaGesamtKmBerechnen: e.tourenart === 'ABA' && !!e.abaGesamtKmBerechnen,
  });
  return { kmGesamt, preisKm };
}

/**
 * Preis nach Preisliste: Preisstufe des Auftraggebers zu den
 * Abrechnungs-km, plus ABA-Aufschlag und E-Fahrzeug-Aufschlag.
 * `breakdown` ist null, wenn Auftraggeber/km fehlen oder keine
 * Preisstufe passt.
 */
export async function berechneTourPreis(e: PreisEingabe): Promise<{
  kmGesamt: number | null;
  preisKm: number | null;
  breakdown: TourPriceBreakdown | null;
}> {
  const { kmGesamt, preisKm } = tourKm(e);
  const breakdown = await fetchTourPriceBreakdown({
    auftraggeberId: e.auftraggeberId,
    km: preisKm,
    tourenart: ((e.tourenart || 'AB') as TourenArt),
    istEFahrzeug: !!e.istEFahrzeug,
  });
  return { kmGesamt, preisKm, breakdown };
}

/** Darf der Preis nach einer km-Änderung automatisch neu gesetzt werden? */
export type PreisEntscheidung =
  | { art: 'berechnen' }
  | { art: 'sondervereinbarung' }
  | { art: 'rechnung'; rechnungsnummer: string };

/**
 * Sondervereinbarung: Der Preis ist von Hand gesetzt und bleibt.
 * (Einen anderen „manuellen Preis" gibt es nicht — das Preisfeld ist in
 * der Maske nur bei Sondervereinbarung editierbar.)
 * Bereits auf Rechnung: Preis bleibt, sonst passen Tour und Rechnung
 * nicht mehr zusammen, ohne dass es jemand merkt.
 */
export function preisEntscheidung(args: {
  istSondervereinbarung: boolean | null | undefined;
  rechnungsnummer: string | null | undefined;
}): PreisEntscheidung {
  if (args.istSondervereinbarung) return { art: 'sondervereinbarung' };
  if (args.rechnungsnummer) return { art: 'rechnung', rechnungsnummer: args.rechnungsnummer };
  return { art: 'berechnen' };
}

/** Hinweis, wenn eine Tour bereits auf einer Rechnung steht. */
export function rechnungsHinweis(rechnungsnummer: string, was: 'Kennzeichen' | 'Fahrzeugdaten' | 'Preis'): string {
  const alt = was === 'Preis' ? 'den alten Preis und die alten km'
    : was === 'Kennzeichen' ? 'das alte Kennzeichen' : 'die alten Fahrzeugdaten';
  return `Diese Tour ist bereits auf Rechnung ${rechnungsnummer} — die Rechnung enthält noch ${alt}. `
    + 'Bei Bedarf dort ‚Touren erneut laden\'.';
}

/** Meldung nach der km-Übernahme. */
export function kmUebernahmeMeldung(args: {
  km: number;
  entscheidung: PreisEntscheidung;
  /** Neu berechneter Preis; null = keine passende Preisstufe. */
  preis: number | null;
}): string {
  const kmText = `km ${args.km.toLocaleString('de-DE')} übernommen`;
  switch (args.entscheidung.art) {
    case 'sondervereinbarung':
      return `${kmText} — Preis wegen Sondervereinbarung nicht neu berechnet.`;
    case 'rechnung':
      return `${kmText} — Preis nicht neu berechnet. ${rechnungsHinweis(args.entscheidung.rechnungsnummer, 'Preis')}`;
    case 'berechnen':
      return args.preis == null
        ? `${kmText} — keine passende Preisstufe gefunden, Preis bitte prüfen.`
        : `${kmText}, Preis ${formatEuro(args.preis)} berechnet.`;
  }
}
