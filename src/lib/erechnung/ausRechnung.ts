// Rechnung bzw. Storno/Teilgutschrift (Datenbank) → ERechnungDaten.
//
// Beträge: Positionen 1:1 aus der Datenbank, Summen aus
// berechneSummenProUst() — exakt derselbe Aufruf wie bei der PDF-
// Erzeugung. Es gibt keine zweite Rechenlogik für die E-Rechnung.
//
// Absender: der Firmendaten-Snapshot am Beleg (ab Migration 116); ohne
// Snapshot (Entwurf / Altbeleg) die übergebenen bzw. Vorgabe-Firmendaten.

import { berechneSummenProUst } from '../rechnungsformat';
import { FIRMENDATEN, firmendatenAusJson, type Firmendaten } from '../firmendaten';
import { supabase } from '../supabase';
import type { Database } from '../../types/supabase';
import {
  TYP_CODE_KORREKTUR, TYP_CODE_RECHNUNG,
  type ERechnungDaten, type ERechnungPartei, type ERechnungPosition,
} from './typen';
import { gleicheAdresszeile, landZuIso, normLandCode, trennePlzOrt } from './stammdaten';
import { LEISTUNGSDATUM_HINWEIS_LESEKOPIE } from './texte';
import type { Mangel } from './pruefung';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];
type AuftraggeberRow = Database['public']['Tables']['auftraggeber']['Row'];
type GutschriftRow = Database['public']['Tables']['gutschriften']['Row'];
type GutschriftPositionRow = Database['public']['Tables']['gutschriftspositionen']['Row'];

/** Feste Mengeneinheit (E1): immer Stück. einheit_code bleibt für später. */
export const EINHEIT_STUECK = 'C62';

export interface ERechnungQuelle {
  rechnung: RechnungRow;
  positionen: PositionRow[];
  auftraggeber: Pick<AuftraggeberRow, 'kunden_uid' | 'zahlungsziel_tage'>
    & Partial<Pick<AuftraggeberRow, 'erechnung_email' | 'kaeufer_referenz' | 'land_code' | 'erechnung_format'>> | null;
}

export interface Abbildung {
  daten: ERechnungDaten;
  /** Hinweise aus der Abbildung selbst (Ableitungen, Ausnahmen). */
  hinweise: Mangel[];
  /** Gesetzt, wenn für diesen Beleg (noch) keine E-Rechnung erzeugt werden darf. */
  abbruch: string | null;
}

export interface AbbildungOptionen {
  /**
   * Nur Test-Export: fehlende Felder bei Altrechnungen (vor Migration
   * 115) aus dem bisherigen PLZ/Ort-Feld bzw. den aktuellen
   * Auftraggeber-Stammdaten ableiten — jeweils mit Hinweis.
   */
  testAbleitung?: boolean;
  /** Firmendaten, falls der Beleg (noch) keinen Snapshot hat. */
  firma?: Firmendaten;
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

function verkaeufer(f: Firmendaten): ERechnungDaten['verkaeufer'] {
  return {
    name: f.name,
    strasse: f.strasse,
    plz: f.plz,
    ort: f.ort,
    landCode: f.landCode,
    ustId: f.ustId || null,
    steuernummer: f.steuernummer,
    kontaktName: f.kontaktName,
    telefon: f.kontaktTelefon ?? f.telefon,
    email: f.kontaktEmail ?? f.email,
    elektronischeAdresse: f.elektronischeAdresse,
    iban: f.iban,
    bic: f.bic || null,
  };
}

function firmaFuer(snapshot: unknown, opt: AbbildungOptionen): Firmendaten {
  if (snapshot && typeof snapshot === 'object') return firmendatenAusJson(snapshot);
  return opt.firma ?? FIRMENDATEN;
}

/** Leistungszeitraum der Rechnung: frühestes/spätestes Positionsdatum, sonst der gespeicherte Zeitraum. */
function zeitraum(pos: ERechnungPosition[], von: string | null, bis: string | null): { von: string | null; bis: string | null } {
  const daten = pos.map((p) => p.leistungsdatum).filter((x): x is string => !!x).sort();
  if (daten.length) return { von: daten[0], bis: daten[daten.length - 1] };
  return { von, bis };
}

function positionenAbbilden(
  rows: Array<{ position_nr: number; bezeichnung: string; unterzeilen: unknown; menge: number; einzelpreis: number;
    gesamtpreis: number; ust_satz: number | null; leistungsdatum?: string | null; steuerkategorie?: string | null }>,
  defaultSatz: number,
): ERechnungPosition[] {
  return [...rows].sort((a, b) => a.position_nr - b.position_nr).map((p, idx) => {
    const satz = p.ust_satz == null ? defaultSatz : Number(p.ust_satz);
    const zeilen = Array.isArray(p.unterzeilen) ? (p.unterzeilen as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return {
      nr: idx + 1,
      bezeichnung: p.bezeichnung,
      beschreibung: zeilen.map((z) => z.trim()).filter(Boolean).join('\n') || null,
      menge: Number(p.menge),
      einheitCode: EINHEIT_STUECK,
      einzelpreis: Number(p.einzelpreis),
      netto: Number(p.gesamtpreis),
      ustSatz: satz,
      kategorie: p.steuerkategorie ?? (satz > 0 ? 'S' : 'unbestimmt'),
      leistungsdatum: p.leistungsdatum ?? null,
    };
  });
}

function summen(rows: Array<{ gesamtpreis: number; ust_satz: number | null }>, defaultSatz: number): ERechnungDaten['summen'] {
  const sum = berechneSummenProUst(
    rows.map((p) => ({ gesamtpreis: Number(p.gesamtpreis), ust_satz: p.ust_satz == null ? null : Number(p.ust_satz) })),
    defaultSatz,
  );
  return {
    gruppen: sum.groups.map((g) => ({ kategorie: g.satz > 0 ? 'S' : 'unbestimmt', satz: g.satz, netto: g.netto, ust: g.ust })),
    netto: sum.netto,
    ust: sum.ust,
    brutto: sum.brutto,
  };
}

interface Adresse { firma: string | null; ansprechpartner: string | null; strasse: string | null; plz_ort: string | null; land: string | null;
  plz: string | null; ort: string | null; land_code: string | null }

function kaeufer(a: Adresse, extra: { ustId: string | null; kennung: string | null; sachbearbeiter: string | null; email: string | null },
  hinweise: Mangel[], test: boolean): ERechnungPartei {
  let plz = a.plz;
  let ort = a.ort;
  if ((plz || ort) && !gleicheAdresszeile([plz, ort].filter(Boolean).join(' '), a.plz_ort)) {
    hinweise.push({ bt: 'BT-52/53', schwere: 'fehler',
      text: `PLZ/Ort (${[plz, ort].filter(Boolean).join(' ')}) weichen vom Adressfeld („${a.plz_ort ?? ''}") ab.` });
  }
  if (!plz && !ort && test) {
    const v = trennePlzOrt(a.plz_ort, a.land);
    if (v.status === 'eindeutig') {
      plz = v.plz; ort = v.ort;
      hinweise.push({ bt: 'BT-52/53', schwere: 'hinweis', text: `PLZ/Ort für den Test aus „${a.plz_ort}" abgeleitet (Beleg vor Migration 115).` });
    }
  }
  let landCode = normLandCode(a.land_code);
  if (!landCode && test) {
    landCode = landZuIso(a.land);
    if (landCode) hinweise.push({ bt: 'BT-55', schwere: 'hinweis', text: `Ländercode ${landCode} für den Test aus „${a.land || '(leer)'}" abgeleitet.` });
  }
  const firmaName = (a.firma ?? '').trim();
  const ansprechpartner = (a.ansprechpartner ?? '').trim();
  return {
    name: firmaName || ansprechpartner,
    strasse: a.strasse,
    plz, ort, landCode,
    ustId: extra.ustId,
    kennung: extra.kennung,
    // „Sachbearbeiter" ist der Sachbearbeiter des Kunden (B3) → BG-9.
    kontaktName: (extra.sachbearbeiter ?? '').trim() || (firmaName && ansprechpartner ? ansprechpartner : null),
    elektronischeAdresse: extra.email,
  };
}

// ================================================================ Rechnung

export function bildeERechnung(q: ERechnungQuelle, opt: AbbildungOptionen = {}): Abbildung {
  const r = q.rechnung;
  const ag = q.auftraggeber;
  const firma = firmaFuer(r.absender_snapshot, opt);
  const hinweise: Mangel[] = [];
  const test = !!opt.testAbleitung;
  const manuell = r.empfaenger_typ === 'manuell';
  const abbruch: string | null = null;

  if (r.status === 'entwurf') {
    hinweise.push({ bt: 'BT-1', schwere: 'hinweis', text: 'Rechnung ist noch ein Entwurf.' });
  }
  if (r.status === 'storniert') {
    hinweise.push({ bt: 'BT-1', schwere: 'hinweis', text: 'Rechnung ist storniert.' });
  }

  const defaultSatz = Number(r.ust_satz) || 0;
  const positionen = positionenAbbilden(q.positionen, defaultSatz);
  const z = zeitraum(positionen, r.leistungszeitraum_von ?? null, r.leistungszeitraum_bis ?? null);

  let email = r.erechnung_email ?? null;
  let referenz = r.kaeufer_referenz ?? null;
  if (!manuell && ag && (test || r.status === 'entwurf')) {
    // Vor dem Erstellen (bzw. im Test) gelten die Stammdaten des Auftraggebers.
    if (!email && ag.erechnung_email) {
      email = ag.erechnung_email;
      if (test) hinweise.push({ bt: 'BT-49', schwere: 'hinweis', text: 'E-Rechnungs-Adresse aus den aktuellen Auftraggeber-Daten.' });
    }
    if (!referenz && ag.kaeufer_referenz) {
      referenz = ag.kaeufer_referenz;
      if (test) hinweise.push({ bt: 'BT-10', schwere: 'hinweis', text: 'Käuferreferenz aus den aktuellen Auftraggeber-Daten.' });
    }
  }

  const ziel = r.zahlungsziel_tage ?? (manuell ? null : ag?.zahlungsziel_tage ?? null);
  const faellig = r.faellig_am ?? (ziel != null && r.datum ? plusTage(r.datum, Number(ziel)) : null);

  const daten: ERechnungDaten = {
    typ: TYP_CODE_RECHNUNG,
    nummer: r.rechnungsnummer,
    datum: r.datum,
    faelligAm: faellig,
    zahlungszielTage: ziel,
    leistungVon: z.von,
    leistungBis: z.bis,
    waehrung: 'EUR',
    kaeuferReferenz: referenz,
    notizen: [LEISTUNGSDATUM_HINWEIS_LESEKOPIE],
    verkaeufer: verkaeufer(firma),
    kaeufer: kaeufer({
      firma: r.rechnungsadresse_firma, ansprechpartner: r.ansprechpartner, strasse: r.rechnungsadresse_strasse,
      plz_ort: r.rechnungsadresse_plz_ort, land: r.rechnungsadresse_land,
      plz: r.rechnungsadresse_plz ?? null, ort: r.rechnungsadresse_ort ?? null, land_code: r.rechnungsadresse_land_code ?? null,
    }, {
      ustId: manuell ? (r.empfaenger_ust_id ?? null) : (ag?.kunden_uid ?? null),
      kennung: r.kundennummer ?? null,
      sachbearbeiter: r.sachbearbeiter ?? null,
      email,
    }, hinweise, test),
    positionen,
    summen: summen(q.positionen, defaultSatz),
  };
  return { daten, hinweise, abbruch };
}

/** Lädt Rechnung, Positionen und Auftraggeber frisch aus der Datenbank. */
export async function ladeERechnungQuelle(rechnungId: string): Promise<ERechnungQuelle> {
  const [rRes, pRes] = await Promise.all([
    supabase.from('rechnungen')
      .select('*, auftraggeber:auftraggeber_id (*)')
      .eq('id', rechnungId).single(),
    supabase.from('rechnungspositionen')
      .select('*').eq('rechnung_id', rechnungId)
      .order('position_nr', { ascending: true }),
  ]);
  if (rRes.error) throw new Error(rRes.error.message);
  if (pRes.error) throw new Error(pRes.error.message);
  const { auftraggeber, ...rechnung } = rRes.data as unknown as RechnungRow & { auftraggeber: AuftraggeberRow | null };
  return { rechnung: rechnung as RechnungRow, positionen: (pRes.data ?? []) as PositionRow[], auftraggeber };
}

// ================================================================ Storno / Teilgutschrift

export interface GutschriftQuelle {
  gutschrift: GutschriftRow;
  positionen: GutschriftPositionRow[];
  auftraggeber: Pick<AuftraggeberRow, 'kunden_uid'> | null;
}

function datumDe(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function bildeERechnungGutschrift(q: GutschriftQuelle, opt: AbbildungOptionen = {}): Abbildung {
  const g = q.gutschrift;
  const hinweise: Mangel[] = [];
  let abbruch: string | null = null;
  if (g.art !== 'storno' && g.art !== 'teilgutschrift') {
    abbruch = 'Nur Stornorechnungen und Teilgutschriften werden als E-Rechnung erzeugt.';
  }
  if (!g.bezug_rechnungsnummer) abbruch = abbruch ?? 'Bezug auf die Originalrechnung fehlt.';
  const firma = firmaFuer(g.absender_snapshot, opt);
  const defaultSatz = Number(g.ust_satz) || 0;
  const positionen = positionenAbbilden(q.positionen, defaultSatz);
  const z = zeitraum(positionen, g.leistungszeitraum_von ?? null, g.leistungszeitraum_bis ?? null);
  const a = (g.adress_snapshot && typeof g.adress_snapshot === 'object' ? g.adress_snapshot : {}) as Record<string, string | null>;
  const manuell = g.empfaenger_typ === 'manuell';
  const bezugText = `Bezug: Rechnung ${g.bezug_rechnungsnummer ?? ''}${g.bezug_rechnungsdatum ? ` vom ${datumDe(g.bezug_rechnungsdatum)}` : ''}`;

  const daten: ERechnungDaten = {
    typ: TYP_CODE_KORREKTUR,
    bezug: g.bezug_rechnungsnummer ? { nummer: g.bezug_rechnungsnummer, datum: g.bezug_rechnungsdatum ?? null } : null,
    zahlungsText: bezugText,
    nummer: g.gutschrift_nr,
    datum: g.datum,
    faelligAm: null,
    zahlungszielTage: null,
    leistungVon: z.von,
    leistungBis: z.bis,
    waehrung: 'EUR',
    kaeuferReferenz: g.kaeufer_referenz ?? null,
    notizen: [LEISTUNGSDATUM_HINWEIS_LESEKOPIE, ...(g.einleitungstext ? [g.einleitungstext] : [])],
    verkaeufer: verkaeufer(firma),
    kaeufer: kaeufer({
      firma: a.firma ?? null, ansprechpartner: a.ansprechpartner ?? null, strasse: a.strasse ?? null,
      plz_ort: a.plz_ort ?? null, land: a.land ?? null, plz: a.plz ?? null, ort: a.ort ?? null, land_code: a.land_code ?? null,
    }, {
      ustId: manuell ? (g.empfaenger_ust_id ?? null) : (q.auftraggeber?.kunden_uid ?? null),
      kennung: g.kundennummer ?? null,
      sachbearbeiter: g.sachbearbeiter ?? null,
      email: g.erechnung_email ?? null,
    }, hinweise, !!opt.testAbleitung),
    positionen,
    summen: summen(q.positionen, defaultSatz),
  };
  return { daten, hinweise, abbruch };
}

export async function ladeGutschriftQuelle(gutschriftId: string): Promise<GutschriftQuelle> {
  const [gRes, pRes] = await Promise.all([
    supabase.from('gutschriften').select('*, auftraggeber:auftraggeber_id (kunden_uid)').eq('id', gutschriftId).single(),
    supabase.from('gutschriftspositionen').select('*').eq('gutschrift_id', gutschriftId).order('position_nr', { ascending: true }),
  ]);
  if (gRes.error) throw new Error(gRes.error.message);
  if (pRes.error) throw new Error(pRes.error.message);
  const { auftraggeber, ...gutschrift } = gRes.data as unknown as GutschriftRow & { auftraggeber: { kunden_uid: string | null } | null };
  return { gutschrift: gutschrift as GutschriftRow, positionen: (pRes.data ?? []) as GutschriftPositionRow[], auftraggeber };
}
