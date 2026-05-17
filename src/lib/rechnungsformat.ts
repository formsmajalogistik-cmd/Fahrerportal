// Rechnungsformat-Konfiguration pro Auftraggeber.
// Wird als JSONB in auftraggeber.rechnungsformat gespeichert; der
// Editor lädt Vorlagen aus den Konstanten unten und der Admin kann
// sie nachträglich frei anpassen.

export type ZusaetzeDarstellung = 'einzeln' | 'zusammengefasst' | 'keine';
export type DatumFormat = 'kurz' | 'lang' | 'enddatum_kurz' | 'enddatum_lang';

export interface Rechnungsformat {
  /** Identifier der Ausgangsvorlage — rein informativ. */
  format_typ?: string;
  // ---- Tour-Darstellung ----
  tour_bezeichnung: string;
  tour_unterzeilen: string[];
  aba_bezeichnung: string;
  aba_unterzeilen: string[];
  abc_bezeichnung: string;
  abc_unterzeilen: string[];
  tourenart_anzeigen: boolean;
  datum_format: DatumFormat;
  // ---- Zusätze ----
  zusaetze_darstellung: ZusaetzeDarstellung;
  zusatz_bezeichnung: string;
  zusatz_notiz_als_unterzeile: boolean;
  // ---- Getrennte Auslagen-Rechnung (CC-Fall) ----
  getrennte_auslagen_rechnung: boolean;
  auslagen_bezeichnung: string;
  auslagen_unterzeilen: string[];
  // ---- Meta / Layout ----
  anrede: string;
  ust_satz: number;
  spalten: Array<'pos' | 'bezeichnung' | 'menge' | 'einzelpreis' | 'gesamtpreis'>;
}

export const DEFAULT_RECHNUNGSFORMAT: Rechnungsformat = {
  format_typ: 'standard',
  tour_bezeichnung: '{start} nach {ziel} {datum}',
  tour_unterzeilen: ['{kennzeichen}'],
  aba_bezeichnung: '{start} nach {ziel} nach {rueckfuehrung} {datum}',
  aba_unterzeilen: ['ABA {kennzeichen_hin}/{kennzeichen_rueck}'],
  abc_bezeichnung: '{start} nach {ziel} nach {rueckfuehrung} {datum}',
  abc_unterzeilen: ['ABC {kennzeichen_hin}/{kennzeichen_rueck}'],
  tourenart_anzeigen: true,
  datum_format: 'kurz',
  zusaetze_darstellung: 'einzeln',
  zusatz_bezeichnung: '{kategorie} {kennzeichen}',
  zusatz_notiz_als_unterzeile: false,
  getrennte_auslagen_rechnung: false,
  auslagen_bezeichnung: '{kategorie} {kennzeichen}',
  auslagen_unterzeilen: ['{start} nach {ziel} {datum}'],
  anrede: 'Sehr geehrte Damen und Herren,',
  ust_satz: 19,
  spalten: ['pos', 'bezeichnung', 'menge', 'einzelpreis', 'gesamtpreis'],
};

// ============================================================
// Vorlagen — werden im Editor über das "Vorlage laden"-Dropdown
// angeboten. Reine Frontend-Konstanten; KEIN DB-Seed.
// ============================================================

export interface RechnungsformatVorlage {
  id: string;
  label: string;
  beschreibung: string;
  format: Rechnungsformat;
}

const STANDARD: Rechnungsformat = { ...DEFAULT_RECHNUNGSFORMAT };

const CARSYSTEME: Rechnungsformat = {
  ...DEFAULT_RECHNUNGSFORMAT,
  format_typ: 'carsysteme',
  tourenart_anzeigen: false,
  aba_unterzeilen: ['{kennzeichen_hin}/{kennzeichen_rueck}'],
  abc_unterzeilen: ['{kennzeichen_hin}/{kennzeichen_rueck}'],
};

const CC_TOUREN: Rechnungsformat = {
  ...DEFAULT_RECHNUNGSFORMAT,
  format_typ: 'cc_touren',
  tour_bezeichnung: '{start} nach {ziel} {datum}',
  tour_unterzeilen: ['{tourenart} {kennzeichen}'],
  aba_unterzeilen: ['ABA {kennzeichen_hin}/{kennzeichen_rueck}'],
  abc_unterzeilen: ['ABC {kennzeichen_hin}/{kennzeichen_rueck}'],
  zusaetze_darstellung: 'keine',
  getrennte_auslagen_rechnung: true,
  auslagen_bezeichnung: '{kategorie} {kennzeichen}',
  auslagen_unterzeilen: ['{start} nach {ziel} {datum}'],
};

const FAHRAUFTRAG_KZ: Rechnungsformat = {
  ...DEFAULT_RECHNUNGSFORMAT,
  format_typ: 'fahrauftrag_kz',
  tour_bezeichnung: 'Fahrauftrag {kundenname} {datum}',
  tour_unterzeilen: ['{kennzeichen}', '', '{start} nach {ziel}'],
  aba_bezeichnung: 'Fahrauftrag {kundenname} {datum}',
  aba_unterzeilen: ['{kennzeichen_hin}/{kennzeichen_rueck}', '', '{start} nach {ziel} nach {rueckfuehrung}'],
  abc_bezeichnung: 'Fahrauftrag {kundenname} {datum}',
  abc_unterzeilen: ['{kennzeichen_hin}/{kennzeichen_rueck}', '', '{start} nach {ziel} nach {rueckfuehrung}'],
  tourenart_anzeigen: false,
  zusatz_bezeichnung: '{kategorie} {start} nach {ziel}',
  zusatz_notiz_als_unterzeile: true,
};

const FAHRAUFTRAG_FIN: Rechnungsformat = {
  ...FAHRAUFTRAG_KZ,
  format_typ: 'fahrauftrag_fin',
  tour_unterzeilen: ['FIN: {fin}', '', '{start} nach {ziel}'],
  aba_unterzeilen: ['FIN: {fin}', '', '{start} nach {ziel} nach {rueckfuehrung}'],
  abc_unterzeilen: ['FIN: {fin}', '', '{start} nach {ziel} nach {rueckfuehrung}'],
};

export const RECHNUNGSFORMAT_VORLAGEN: RechnungsformatVorlage[] = [
  { id: 'standard',         label: 'Standard (Greimel)',           beschreibung: 'Tour + Zusätze separat, Tourenart angezeigt',     format: STANDARD },
  { id: 'carsysteme',       label: 'Carsysteme (ohne Tourenart)',  beschreibung: 'Wie Standard, aber ohne ABC/ABA-Label',           format: CARSYSTEME },
  { id: 'cc_touren',        label: 'CC Touren + getrennte Auslagen',beschreibung: 'Zwei getrennte Rechnungen: Touren und Auslagen',  format: CC_TOUREN },
  { id: 'fahrauftrag_kz',   label: 'Fahrauftrag (mit Kennzeichen)',beschreibung: 'Kundenname in der Bezeichnung, Route als Unterzeile', format: FAHRAUFTRAG_KZ },
  { id: 'fahrauftrag_fin',  label: 'Fahrauftrag (mit FIN)',        beschreibung: 'Wie Fahrauftrag, aber mit FIN statt Kennzeichen', format: FAHRAUFTRAG_FIN },
];

// ============================================================
// Platzhalter & Pattern-Resolver
// ============================================================

export const RECHNUNG_PLATZHALTER = [
  'start', 'ziel', 'rueckfuehrung',
  'datum', 'datum_von', 'datum_bis',
  'kennzeichen', 'kennzeichen_hin', 'kennzeichen_rueck',
  'kundenname', 'fin', 'tourenart',
  'kategorie', 'sondervereinbarung', 'ansprechpartner',
] as const;

export function resolveRechnungsPattern(
  pattern: string,
  values: Partial<Record<string, string>>,
): string {
  if (!pattern) return '';
  return pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const v = values[key];
    return v == null ? '' : v;
  }).replace(/\s+/g, ' ').trim();
}

// ============================================================
// HTML-Vorschau für den Editor — mit fiktiven Beispiel-Touren
// ============================================================

export interface RechnungVorschauTour {
  tourenart: 'AB' | 'ABA' | 'ABC';
  start: string;
  ziel: string;
  rueckfuehrung?: string;
  datum: string;
  kennzeichen: string;
  kennzeichen_rueck?: string;
  kundenname?: string;
  fin?: string;
  preis: number;
  zusaetze: Array<{ kategorie: string; anzahl: number; betrag: number; notiz?: string }>;
}

const BEISPIEL_TOUREN: RechnungVorschauTour[] = [
  {
    tourenart: 'AB',
    start: 'Ebersberg',
    ziel: 'Kerpen',
    datum: '13.5./15.5.26',
    kennzeichen: 'M-CC4783E',
    kundenname: 'Tevi',
    fin: '008870',
    preis: 192.0,
    zusaetze: [
      { kategorie: 'Ladezeiten', anzahl: 3, betrag: 10.0 },
      { kategorie: 'Ladeauslagen', anzahl: 1, betrag: 127.6 },
    ],
  },
  {
    tourenart: 'ABA',
    start: 'Hodenhagen',
    ziel: 'Mehlbek',
    rueckfuehrung: 'Oelde',
    datum: '13.5./15.5.26',
    kennzeichen: 'HN-LD396',
    kennzeichen_rueck: 'HN-LD524',
    kundenname: 'Müller',
    fin: '019234',
    preis: 180.0,
    zusaetze: [],
  },
];

interface RenderedPosition {
  bezeichnung: string;
  unterzeilen: string[];
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
}

function formatEur(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
}

function pickTourTemplate(f: Rechnungsformat, art: 'AB' | 'ABA' | 'ABC'): { bezeichnung: string; unterzeilen: string[] } {
  if (art === 'ABA') return { bezeichnung: f.aba_bezeichnung, unterzeilen: f.aba_unterzeilen };
  if (art === 'ABC') return { bezeichnung: f.abc_bezeichnung, unterzeilen: f.abc_unterzeilen };
  return { bezeichnung: f.tour_bezeichnung, unterzeilen: f.tour_unterzeilen };
}

function buildPlaceholders(t: RechnungVorschauTour): Record<string, string> {
  return {
    start: t.start,
    ziel: t.ziel,
    rueckfuehrung: t.rueckfuehrung ?? '',
    datum: t.datum,
    datum_von: t.datum.split('/')[0] ?? t.datum,
    datum_bis: t.datum.split('/')[1] ?? t.datum,
    kennzeichen: t.kennzeichen,
    kennzeichen_hin: t.kennzeichen,
    kennzeichen_rueck: t.kennzeichen_rueck ?? '',
    kundenname: t.kundenname ?? '',
    fin: t.fin ?? '',
    tourenart: t.tourenart,
  };
}

interface RechnungSection {
  titel: string;
  positionen: RenderedPosition[];
}

export function renderRechnungSections(
  f: Rechnungsformat,
  touren: RechnungVorschauTour[] = BEISPIEL_TOUREN,
): RechnungSection[] {
  const haupt: RenderedPosition[] = [];
  const auslagen: RenderedPosition[] = [];

  for (const t of touren) {
    const ph = buildPlaceholders(t);
    const tpl = pickTourTemplate(f, t.tourenart);
    // Wenn Tourenart NICHT anzeigt werden soll, ist tourenart='' im Platzhalter.
    if (!f.tourenart_anzeigen) ph.tourenart = '';
    haupt.push({
      bezeichnung: resolveRechnungsPattern(tpl.bezeichnung, ph),
      unterzeilen: tpl.unterzeilen.map((u) => resolveRechnungsPattern(u, ph)),
      menge: 1,
      einzelpreis: t.preis,
      gesamtpreis: t.preis,
    });

    if (t.zusaetze.length === 0) continue;
    if (f.zusaetze_darstellung === 'keine' && !f.getrennte_auslagen_rechnung) continue;

    for (const z of t.zusaetze) {
      const zph = { ...ph, kategorie: z.kategorie };
      const targetTpl = f.getrennte_auslagen_rechnung
        ? { bezeichnung: f.auslagen_bezeichnung, unterzeilen: f.auslagen_unterzeilen }
        : { bezeichnung: f.zusatz_bezeichnung, unterzeilen: [] as string[] };
      const pos: RenderedPosition = {
        bezeichnung: resolveRechnungsPattern(targetTpl.bezeichnung, zph),
        unterzeilen: targetTpl.unterzeilen.map((u) => resolveRechnungsPattern(u, zph)),
        menge: z.anzahl,
        einzelpreis: z.betrag,
        gesamtpreis: z.anzahl * z.betrag,
      };
      if (f.zusatz_notiz_als_unterzeile && z.notiz) {
        pos.unterzeilen.push(z.notiz);
      }
      if (f.getrennte_auslagen_rechnung) auslagen.push(pos);
      else if (f.zusaetze_darstellung !== 'keine') haupt.push(pos);
    }
  }

  const out: RechnungSection[] = [];
  if (haupt.length > 0) out.push({ titel: f.getrennte_auslagen_rechnung ? 'Touren' : 'Rechnung', positionen: haupt });
  if (auslagen.length > 0) out.push({ titel: 'Auslagen', positionen: auslagen });
  return out;
}

export function summe(positionen: RenderedPosition[]): number {
  return positionen.reduce((acc, p) => acc + p.gesamtpreis, 0);
}

export { formatEur };
