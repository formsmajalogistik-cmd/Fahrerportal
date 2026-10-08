// Schnell-Zeiträume der Tourenliste („Vortag", „Diese Woche", …).
//
// Reine Logik, damit Admin-/Fahrer-Ansicht (TourenlistePage) und
// Auftraggeber-Ansicht dieselben Bereiche verwenden und die Regeln testbar
// sind. Datumswerte sind lokale Kalendertage als 'YYYY-MM-DD'.

import { letzterWerktagVor, naechsterWerktagNach } from './rechnungsformat';

export type ZeitraumKey =
  | 'heute' | 'vortag' | 'naechster' | 'woche' | 'monat'
  | 'jahr' | 'dreiMonate' | 'vorjahr' | 'alle';

export interface Zeitraum {
  key: ZeitraumKey;
  label: string;
  von: string;
  bis: string;
  /** 'schnell' = sichtbarer Knopf, 'weitere' = im Dropdown. */
  gruppe: 'schnell' | 'weitere';
  /** Tages-Knopf: zweiter Klick stellt den Monat wieder her. */
  tag?: boolean;
  title?: string;
}

export const ALLE_VON = '2000-01-01';
export const ALLE_BIS = '2099-12-31';

/** Lokales Datum als 'YYYY-MM-DD' (keine UTC-Verschiebung). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Kalenderwoche nach deutscher Zählung: Montag bis Sonntag.
 * (getDay(): 0 = Sonntag — der Sonntag gehört zur Woche davor.)
 */
export function wocheVonBis(heute: Date): { von: string; bis: string } {
  const abMontag = (heute.getDay() + 6) % 7;
  const montag = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - abMontag);
  const sonntag = new Date(montag.getFullYear(), montag.getMonth(), montag.getDate() + 6);
  return { von: ymd(montag), bis: ymd(sonntag) };
}

/** Alle Zeiträume, in Anzeigereihenfolge je Gruppe. */
export function zeitraeume(heute: Date): Zeitraum[] {
  const j = heute.getFullYear();
  const m = heute.getMonth();
  const heuteYmd = ymd(heute);
  const vortag = ymd(letzterWerktagVor(heute));
  const naechster = ymd(naechsterWerktagNach(heute));
  const woche = wocheVonBis(heute);
  return [
    { key: 'vortag', label: 'Vortag', von: vortag, bis: vortag, gruppe: 'schnell', tag: true },
    { key: 'naechster', label: 'Nächster Tag', von: naechster, bis: naechster, gruppe: 'schnell', tag: true },
    { key: 'woche', label: 'Diese Woche', von: woche.von, bis: woche.bis, gruppe: 'schnell', title: 'Montag bis Sonntag der aktuellen Kalenderwoche' },
    { key: 'monat', label: 'Aktueller Monat', von: ymd(new Date(j, m, 1)), bis: ymd(new Date(j, m + 1, 0)), gruppe: 'schnell' },
    { key: 'heute', label: 'Heute', von: heuteYmd, bis: heuteYmd, gruppe: 'weitere', tag: true },
    { key: 'jahr', label: 'Aktuelles Jahr', von: ymd(new Date(j, 0, 1)), bis: ymd(new Date(j, 11, 31)), gruppe: 'weitere' },
    // Ältere Zeiträume — z.B. für Bußgeldanfragen, die Wochen später
    // eintreffen. Geladen wird erst bei Klick.
    { key: 'dreiMonate', label: 'Letzte 3 Monate', von: ymd(new Date(j, m - 3, heute.getDate())), bis: heuteYmd, gruppe: 'weitere' },
    { key: 'vorjahr', label: 'Letztes Jahr', von: ymd(new Date(j - 1, 0, 1)), bis: ymd(new Date(j - 1, 11, 31)), gruppe: 'weitere' },
    { key: 'alle', label: 'Alle', von: ALLE_VON, bis: ALLE_BIS, gruppe: 'weitere', title: 'Alle Touren — kann bei großem Bestand etwas dauern' },
  ];
}

/**
 * Welcher Zeitraum passt genau zu von/bis? Von Hand geänderte Daten
 * passen in der Regel zu keinem — dann ist kein Schnellfilter aktiv.
 */
export function aktiverZeitraum(liste: Zeitraum[], von: string, bis: string): Zeitraum | null {
  return liste.find((z) => z.von === von && z.bis === bis) ?? null;
}
