// ABA-/ABC-Tour in zwei AB-Touren aufteilen — die Regeln für die
// Vorschau. Die eigentliche Aufteilung macht die Datenbankfunktion
// tour_aufteilen (Migration 106) in einer Transaktion; hier wird nur
// vorbereitet, was der Admin in der Vorschau sieht und entscheidet.
//
//   ABC  A → B → C   ⇒  Tour 1: A → B   Tour 2: B → C
//   ABA  A → B → A   ⇒  Tour 1: A → B   Tour 2: B → A

import { fahrzeugWertGleich } from './fahrzeugAbgleich';
import { formatEuro } from './touren';

export type TourNr = 1 | 2;

export interface AufteilbareTour {
  tourenart: string | null;
  rueckfuehrung_stadt: string | null;
  start_stadt: string;
  ziel_stadt: string;
  kennzeichen: string[] | null;
  eingang_id: string | null;
  eingang_id_bc: string | null;
}

/** Nur ABA/ABC mit Rückführung lassen sich aufteilen. */
export function istAufteilbar(t: Pick<AufteilbareTour, 'tourenart' | 'rueckfuehrung_stadt'>): boolean {
  return (t.tourenart === 'ABA' || t.tourenart === 'ABC') && !!t.rueckfuehrung_stadt?.trim();
}

/** Routen der beiden neuen Touren. */
export function aufteilungsRouten(t: AufteilbareTour): { tour1: string; tour2: string } {
  return {
    tour1: `${t.start_stadt} → ${t.ziel_stadt}`,
    tour2: `${t.ziel_stadt} → ${t.rueckfuehrung_stadt ?? '—'}`,
  };
}

export interface ZusatzLite {
  id: string;
  kennzeichen: string | null;
}

/**
 * Zusatz → Tour anhand des Kennzeichens: Kennzeichen Hin → Tour 1,
 * Kennzeichen Rück → Tour 2 (tolerant verglichen). `null` = keine
 * eindeutige Zuordnung → der Admin wählt (Default Tour 1).
 */
export function zusatzZuordnung(z: ZusatzLite, kennzeichen: string[] | null | undefined): TourNr | null {
  const kz = z.kennzeichen?.trim();
  if (!kz) return null;
  const hin = (kennzeichen?.[0] ?? '').trim();
  const rueck = (kennzeichen?.[1] ?? '').trim();
  const passtHin = !!hin && fahrzeugWertGleich(kz, hin);
  const passtRueck = !!rueck && fahrzeugWertGleich(kz, rueck);
  if (passtHin && !passtRueck) return 1;
  if (passtRueck && !passtHin) return 2;
  return null;  // gleiches Fahrzeug hin und rück, oder fremdes Kennzeichen
}

/**
 * Default für einen begonnenen Formular-Entwurf. Ein Entwurf kennt nur
 * die Tour, nicht den Abschnitt. Ist das Hin-Protokoll schon da und das
 * Rück-Protokoll fehlt noch, füllt der Fahrer sehr wahrscheinlich gerade
 * den Rück-Teil aus → Tour 2. Sonst Tour 1.
 */
export function entwurfDefault(t: Pick<AufteilbareTour, 'eingang_id' | 'eingang_id_bc'>): TourNr {
  return t.eingang_id && !t.eingang_id_bc ? 2 : 1;
}

/** „bisher als ABA: 154,70 € · aufgeteilt: 119,00 € + 119,00 € = 238,00 €" */
export function preisVergleichText(args: {
  tourenart: string | null;
  bisher: number | null;
  preis1: number | null;
  preis2: number | null;
}): string {
  const summe = (args.preis1 ?? 0) + (args.preis2 ?? 0);
  const teil = (p: number | null) => (p == null ? 'offen' : formatEuro(p));
  return `bisher als ${args.tourenart ?? 'Tour'}: ${formatEuro(args.bisher)} · aufgeteilt: `
    + `${teil(args.preis1)} + ${teil(args.preis2)} = ${formatEuro(summe)}`;
}

/** Summe ungleich Original → Hinweis (kein Fehler, der Admin entscheidet). */
export function aufteilungsSummeWeichtAb(original: number, teil1: number, teil2: number): boolean {
  return Math.round((teil1 + teil2) * 100) !== Math.round(original * 100);
}

/** Dezimal-Eingabe „1.050,50" / „1050.5" → Zahl; leer → null; ungültig → NaN. */
export function parseBetrag(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export interface TeilTourEingabe {
  fahrerId: string;
  startdatum: string;
  enddatum: string;
  verguetung: number | null;
  fahrerHonorar: number;
  barauslagen: number;
}

/** Optionen für die Datenbankfunktion tour_aufteilen. */
export function aufteilungsOptionen(args: {
  erwartetUpdatedAt: string;
  tour1: TeilTourEingabe;
  tour2: TeilTourEingabe;
  zusatzIdsTour2: string[];
  entwurfIdsTour2: string[];
  zuweisungen: Record<string, '1' | '2' | 'beide'>;
  greimelBei: TourNr;
}): Record<string, unknown> {
  const teil = (t: TeilTourEingabe) => ({
    fahrer_id: t.fahrerId || null,
    startdatum: t.startdatum || null,
    enddatum: t.enddatum || null,
    verguetung: t.verguetung,
    fahrer_honorar: t.fahrerHonorar,
    barauslagen: t.barauslagen,
  });
  return {
    erwartet_updated_at: args.erwartetUpdatedAt,
    tour1: teil(args.tour1),
    tour2: teil(args.tour2),
    zusatz_ids_tour2: args.zusatzIdsTour2,
    entwurf_ids_tour2: args.entwurfIdsTour2,
    zuweisungen: args.zuweisungen,
    greimel_bei: args.greimelBei,
  };
}

/** Fehlermeldung der Rückgängig-Funktion: Tour 1 wurde seither geändert. */
export function istTour1GeaendertFehler(msg: string | null | undefined): boolean {
  return !!msg && msg.includes('TOUR1_GEAENDERT');
}

/** „TOUR1_GEAENDERT: …" ohne den technischen Präfix. */
export function ohneFehlercode(msg: string): string {
  return msg.replace(/^TOUR1_GEAENDERT:\s*/, '');
}
