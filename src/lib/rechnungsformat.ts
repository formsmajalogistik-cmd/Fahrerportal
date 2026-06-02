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
  /**
   * Zusatz-Kategorien, die bei getrennter Auslagen-Rechnung TROTZDEM
   * auf der Touren-Rechnung erscheinen (CC-Sonderfall: Rote Kennzeichen
   * und Wartezeit gehören nicht in die Auslagen, sondern bleiben bei
   * den Touren).
   *
   * Nur ausgewertet, wenn getrennte_auslagen_rechnung = true.
   */
  zusaetze_auf_touren_rechnung: string[];
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
  zusaetze_auf_touren_rechnung: [],
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
  zusaetze_auf_touren_rechnung: ['Rote Kennzeichen', 'Wartezeit'],
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

// ============================================================
// Tour → Rechnungs-Positionen (Live-Daten aus der DB).
// ============================================================

export type TourenartReal = 'AB' | 'ABA' | 'ABC' | null;

/** Eingangs-Daten einer Tour zur Positions-Generierung. */
export interface TourForRechnung {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  startdatum: string | null;
  enddatum: string | null;
  tourenart: TourenartReal;
  kennzeichen: string[];
  kundenname: string | null;
  fin: string | null;
  sondervereinbarung: string | null;
  verguetung: number | null;
  zusaetze: Array<{
    id: string;
    kategorie: string;
    anzahl: number;
    betrag: number;
    notiz: string | null;
    /** Bei ABA-/ABC-Touren das konkrete Kennzeichen (Hin oder Rück);
     *  bei AB-Touren oder Altdaten = null → erstes Tour-Kennzeichen
     *  als Fallback im Platzhalter. */
    kennzeichen: string | null;
  }>;
}

/** Ein einzelner Positionseintrag, wie er in die DB-Tabelle wandert. */
export interface GeneratedRechnungsposition {
  bezeichnung: string;
  unterzeilen: string[];
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
  tour_id: string | null;
  zusatz_id: string | null;
  ist_manuell: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Formatiert einen Datumsbereich gemäß rechnungsformat.datum_format.
 * Wenn `von === bis`, wird nur ein Datum ausgegeben.
 *
 *   "kurz":           "13.5./15.5.26"
 *   "lang":           "13.05.2026/15.05.2026"
 *   "enddatum_kurz":  "15.5.26"
 *   "enddatum_lang":  "15.05.2026"
 *
 * Akzeptiert ISO-Datums-Strings ("YYYY-MM-DD"); bei ungültigen Eingaben
 * wird der Roh-String zurückgereicht.
 */
export function formatRechnungsDatum(
  von: string | null | undefined,
  bis: string | null | undefined,
  format: DatumFormat,
): string {
  const parse = (s: string | null | undefined) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  };
  const a = parse(von);
  const b = parse(bis);
  if (!a && !b) return '';
  if (!a) return formatRechnungsDatum(bis, bis, format);
  if (!b) return formatRechnungsDatum(von, von, format);
  const sameDay = a.y === b.y && a.m === b.m && a.d === b.d;
  const single = sameDay || format === 'enddatum_kurz' || format === 'enddatum_lang';
  const useEnd = single && (format === 'enddatum_kurz' || format === 'enddatum_lang');
  const ref = useEnd ? b : a;

  if (format === 'kurz') {
    const aStr = `${ref.d}.${ref.m}.`;
    if (single) {
      const yy = String(ref.y).slice(-2);
      return `${ref.d}.${ref.m}.${yy}`;
    }
    const bYY = String(b.y).slice(-2);
    return `${aStr}/${b.d}.${b.m}.${bYY}`;
  }
  if (format === 'lang') {
    const aStr = `${pad2(a.d)}.${pad2(a.m)}.${a.y}`;
    if (single) return aStr;
    const bStr = `${pad2(b.d)}.${pad2(b.m)}.${b.y}`;
    return `${aStr}/${bStr}`;
  }
  if (format === 'enddatum_kurz') {
    const yy = String(ref.y).slice(-2);
    return `${ref.d}.${ref.m}.${yy}`;
  }
  // enddatum_lang
  return `${pad2(ref.d)}.${pad2(ref.m)}.${ref.y}`;
}

function placeholdersForTour(
  t: TourForRechnung, format: Rechnungsformat,
): Record<string, string> {
  const datum = formatRechnungsDatum(t.startdatum, t.enddatum, format.datum_format);
  const datumVon = t.startdatum
    ? formatRechnungsDatum(t.startdatum, t.startdatum, format.datum_format)
    : '';
  const datumBis = t.enddatum
    ? formatRechnungsDatum(t.enddatum, t.enddatum, format.datum_format)
    : '';
  const kz = t.kennzeichen?.[0] ?? '';
  const kzRueck = t.kennzeichen?.[1] ?? '';
  return {
    start: t.start_stadt ?? '',
    ziel: t.ziel_stadt ?? '',
    rueckfuehrung: t.rueckfuehrung_stadt ?? '',
    datum,
    datum_von: datumVon,
    datum_bis: datumBis,
    kennzeichen: kz,
    kennzeichen_hin: kz,
    kennzeichen_rueck: kzRueck,
    kundenname: t.kundenname ?? '',
    fin: t.fin ?? '',
    tourenart: format.tourenart_anzeigen ? (t.tourenart ?? '') : '',
    sondervereinbarung: t.sondervereinbarung ?? 'SV',
  };
}

function pickTourTpl(
  format: Rechnungsformat, art: TourenartReal,
): { bezeichnung: string; unterzeilen: string[] } {
  if (art === 'ABA') return { bezeichnung: format.aba_bezeichnung, unterzeilen: format.aba_unterzeilen };
  if (art === 'ABC') return { bezeichnung: format.abc_bezeichnung, unterzeilen: format.abc_unterzeilen };
  return { bezeichnung: format.tour_bezeichnung, unterzeilen: format.tour_unterzeilen };
}

export interface GenerateOptions {
  /**
   * Welcher Rechnungstyp wird gebaut? Wirkt nur, wenn
   * `format.getrennte_auslagen_rechnung === true`:
   *   'touren'   → nur Tour-Positionen (Vergütung), keine Zusätze.
   *   'auslagen' → nur Zusatz-Positionen, formatiert mit auslagen_*.
   *   'beides'   → eine kombinierte Rechnung mit allen Positionen.
   * Bei Formaten ohne getrennte_auslagen_rechnung ist immer alles drin.
   */
  modus: 'touren' | 'auslagen' | 'beides';
}

/**
 * Sortiert Touren für die Positions-Generierung nach den
 * Rechnungs-Anforderungen:
 *   1. Startdatum aufsteigend (frühestes zuerst).
 *   2. Bei gleichem Startdatum: Enddatum aufsteigend.
 *   3. Bei identischem Datum: alphabetisch nach Start-Stadt.
 * Tagestouren (start == ende) ordnen sich damit automatisch ans Ende
 * ihrer Datums-Gruppe — und am Tag selbst nach allen länger laufenden,
 * die am selben Tag enden.
 */
export function sortTourenForRechnung(touren: TourForRechnung[]): TourForRechnung[] {
  const safe = (s: string | null | undefined) => s ?? '9999-99-99';
  return touren.slice().sort((a, b) => {
    const sa = safe(a.startdatum);
    const sb = safe(b.startdatum);
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ea = safe(a.enddatum);
    const eb = safe(b.enddatum);
    if (ea !== eb) return ea < eb ? -1 : 1;
    return (a.start_stadt ?? '').localeCompare(b.start_stadt ?? '', 'de');
  });
}

/**
 * Generiert Rechnungspositionen aus einer Liste echter Touren gemäß dem
 * Rechnungsformat des Auftraggebers. Reihenfolge:
 *   1. Touren werden VOR der Generierung nach Startdatum sortiert
 *      (siehe sortTourenForRechnung).
 *   2. Pro Tour: Tour-Position, danach (sofern aktiviert) deren Zusätze.
 *      Zusätze bleiben damit direkt unter "ihrer" Tour.
 *
 * Touren ohne `verguetung` produzieren KEINE Tour-Position (Schutz vor
 * 0-€-Müll-Zeilen), ihre Zusätze werden aber trotzdem berücksichtigt.
 */
export function generatePositionenFromTouren(
  touren: TourForRechnung[],
  format: Rechnungsformat,
  opts: GenerateOptions = { modus: 'beides' },
): GeneratedRechnungsposition[] {
  const sorted = sortTourenForRechnung(touren);
  const out: GeneratedRechnungsposition[] = [];
  const wantTouren = opts.modus !== 'auslagen';
  const wantZusaetze = format.zusaetze_darstellung === 'einzeln'
    || format.getrennte_auslagen_rechnung;

  // Set der Zusatz-Kategorien, die bei getrennter Auslagen-Rechnung
  // auf der TOUREN-Rechnung erscheinen sollen (CC-Sonderfall: Rote
  // Kennzeichen, Wartezeit). Case-insensitiv + trim, damit kleine
  // Schreibweise-Abweichungen ("rote kennzeichen") trotzdem matchen.
  const aufTourenSet = new Set(
    (format.zusaetze_auf_touren_rechnung ?? []).map((k) => k.trim().toLowerCase()),
  );
  /** Gehört eine Zusatz-Kategorie auf die Touren-Rechnung? */
  function isTouren(kategorie: string): boolean {
    return aufTourenSet.has((kategorie ?? '').trim().toLowerCase());
  }

  for (const t of sorted) {
    const ph = placeholdersForTour(t, format);

    if (wantTouren && t.verguetung != null && t.verguetung > 0) {
      const tpl = pickTourTpl(format, t.tourenart);
      out.push({
        bezeichnung: resolveRechnungsPattern(tpl.bezeichnung, ph),
        unterzeilen: tpl.unterzeilen.map((u) => resolveRechnungsPattern(u, ph))
          .filter((line, i, arr) => !(line === '' && (i === 0 || i === arr.length - 1))),
        menge: 1,
        einzelpreis: Number(t.verguetung),
        gesamtpreis: Number(t.verguetung),
        tour_id: t.id,
        zusatz_id: null,
        ist_manuell: false,
      });
    }

    if (!wantZusaetze) continue;
    for (const z of t.zusaetze) {
      // Bei getrennter Auslagen-Rechnung den Zusatz dem richtigen
      // Modus zuordnen: konfigurierte Kategorien → Touren-Rechnung,
      // alle anderen → Auslagen-Rechnung.
      if (format.getrennte_auslagen_rechnung) {
        const aufTouren = isTouren(z.kategorie);
        if (opts.modus === 'touren'   && !aufTouren) continue;
        if (opts.modus === 'auslagen' &&  aufTouren) continue;
      } else if (opts.modus === 'auslagen') {
        // Modus 'auslagen' macht ohne getrennte_auslagen_rechnung
        // keinen Sinn — defensive: nichts dazumischen.
        continue;
      }

      // Wenn der Zusatz einem konkreten Kennzeichen (Hin/Rück bei
      // ABA/ABC) zugeordnet wurde, überschreibt das die Tour-Platzhalter
      // — die Bezeichnung trägt dann z.B. "M-CC4783E" statt eines
      // Default-Werts. Ohne Zuordnung bleibt das erste Tour-Kennzeichen.
      const zph: Record<string, string> = { ...ph, kategorie: z.kategorie };
      if (z.kennzeichen) {
        zph.kennzeichen = z.kennzeichen;
        zph.kennzeichen_hin = z.kennzeichen;
      }
      // Auslagen-Template wird verwendet, wenn der Zusatz tatsächlich
      // auf der Auslagen-Rechnung landet — also nur bei
      // getrennte_auslagen_rechnung=true UND nicht-Touren-Kategorie.
      const useAuslagenTpl = format.getrennte_auslagen_rechnung
        && !isTouren(z.kategorie);
      const targetTpl = useAuslagenTpl
        ? { bezeichnung: format.auslagen_bezeichnung, unterzeilen: format.auslagen_unterzeilen }
        : { bezeichnung: format.zusatz_bezeichnung, unterzeilen: [] as string[] };
      const unterzeilen = targetTpl.unterzeilen.map((u) => resolveRechnungsPattern(u, zph));
      if (format.zusatz_notiz_als_unterzeile && z.notiz) {
        unterzeilen.push(z.notiz);
      }
      const menge = Number(z.anzahl) || 1;
      const einzel = Number(z.betrag) || 0;
      out.push({
        bezeichnung: resolveRechnungsPattern(targetTpl.bezeichnung, zph),
        unterzeilen,
        menge,
        einzelpreis: einzel,
        gesamtpreis: menge * einzel,
        tour_id: t.id,
        zusatz_id: z.id,
        ist_manuell: false,
      });
    }
  }
  return out;
}

/**
 * Letzter Werktag VOR dem gegebenen Datum (default: heute).
 * Samstag → Freitag, Sonntag → Freitag, Montag → Freitag,
 * sonst → Vortag. Reine Wochenend-Prüfung; Feiertage werden bewusst
 * NICHT betrachtet — kommt bei Bedarf später.
 */
export function letzterWerktagVor(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0); // Mittagspause, schützt vor DST-Schiebungen
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Bei Monatsübergang (letzter Rechnungstag liegt in einem anderen Monat
 * als heute) wird die Auslagen-Rechnung trotzdem im VORMONAT verbucht
 * — Stichtag = letzter Tag des Monats des letzten Rechnungstags.
 *
 * Normalfall (gleicher Monat): heute.
 */
export function auslagenRechnungsdatum(
  letzterRechnungstag: Date | string,
  today: Date = new Date(),
): string {
  const ref = typeof letzterRechnungstag === 'string'
    ? new Date(`${letzterRechnungstag}T12:00:00`)
    : letzterRechnungstag;
  if (ref.getFullYear() === today.getFullYear() && ref.getMonth() === today.getMonth()) {
    return today.toISOString().slice(0, 10);
  }
  // Letzter Tag des Monats: Tag 0 des Folgemonats.
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

/** ISO-Date-only ("YYYY-MM-DD") aus einem Date-Objekt. */
export function isoDate(d: Date): string {
  // toISOString liefert UTC — wir setzen daher vorher die Stunde auf 12, um
  // zwischen Zeitzonen kein anderes Datum rauszufallen.
  const safe = new Date(d);
  safe.setHours(12, 0, 0, 0);
  return safe.toISOString().slice(0, 10);
}

/** Berechnet Netto/USt/Brutto aus einer Positionsliste + USt-Satz. */
export function berechneSummen(
  positionen: Array<{ gesamtpreis: number }>,
  ustSatz: number,
): { netto: number; ust: number; brutto: number } {
  const netto = positionen.reduce((acc, p) => acc + (Number(p.gesamtpreis) || 0), 0);
  const ust = Math.round(netto * (ustSatz / 100) * 100) / 100;
  const brutto = Math.round((netto + ust) * 100) / 100;
  return { netto: Math.round(netto * 100) / 100, ust, brutto };
}
