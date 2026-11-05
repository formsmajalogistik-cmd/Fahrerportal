// Rechnung (Datenbank) → ERechnungDaten.
//
// Beträge: Positionen 1:1 aus der Datenbank, Summen aus
// berechneSummenProUst() — exakt derselbe Aufruf wie bei der PDF-
// Erzeugung (RechnungDetailPage → rechnungPdf). Es gibt keine zweite
// Rechenlogik für die E-Rechnung.

import { berechneSummenProUst } from '../rechnungsformat';
import { FIRMENDATEN, type Firmendaten } from '../firmendaten';
import { supabase } from '../supabase';
import type { Database } from '../../types/supabase';
import type { ERechnungDaten, ERechnungPosition } from './typen';
import { gleicheAdresszeile, landZuIso, normLandCode, trennePlzOrt } from './stammdaten';
import type { Mangel } from './pruefung';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];
type AuftraggeberRow = Database['public']['Tables']['auftraggeber']['Row'];

export interface ERechnungQuelle {
  rechnung: RechnungRow;
  positionen: PositionRow[];
  auftraggeber: Pick<AuftraggeberRow, 'kunden_uid' | 'zahlungsziel_tage'>
    & Partial<Pick<AuftraggeberRow, 'erechnung_email' | 'kaeufer_referenz' | 'land_code'>> | null;
}

export interface Abbildung {
  daten: ERechnungDaten;
  /** Hinweise aus der Abbildung selbst (Ableitungen, Ausnahmen). */
  hinweise: Mangel[];
  /** Gesetzt, wenn für diese Rechnung (noch) keine E-Rechnung erzeugt werden darf. */
  abbruch: string | null;
}

export interface AbbildungOptionen {
  /**
   * Nur Test-Export: fehlende Felder bei Altrechnungen (vor Migration
   * 115) aus dem bisherigen PLZ/Ort-Feld bzw. den aktuellen
   * Auftraggeber-Stammdaten ableiten — jeweils mit Hinweis.
   */
  testAbleitung?: boolean;
  /** Firmendaten überschreiben (nur für Tests). */
  firma?: Firmendaten;
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function bildeERechnung(q: ERechnungQuelle, opt: AbbildungOptionen = {}): Abbildung {
  const r = q.rechnung;
  const ag = q.auftraggeber;
  const firma = opt.firma ?? FIRMENDATEN;
  const hinweise: Mangel[] = [];
  const test = !!opt.testAbleitung;
  const manuell = r.empfaenger_typ === 'manuell';
  let abbruch: string | null = null;

  if (r.ist_auslagen_rechnung) {
    abbruch = 'Auslagenrechnung — als E-Rechnung vorerst ausgenommen (steuerliche Behandlung der Auslagen: Frage S3).';
  }
  if (r.status === 'entwurf') {
    hinweise.push({ bt: 'BT-1', schwere: 'hinweis', text: 'Rechnung ist noch ein Entwurf.' });
  }

  // ---- Positionen (Reihenfolge und Nummerierung wie im PDF) ----
  const defaultSatz = Number(r.ust_satz) || 0;
  const sortiert = [...q.positionen].sort((a, b) => a.position_nr - b.position_nr);
  const positionen: ERechnungPosition[] = sortiert.map((p, idx) => {
    const satz = p.ust_satz == null ? defaultSatz : Number(p.ust_satz);
    const kat = p.steuerkategorie ?? (satz > 0 ? 'S' : 'unbestimmt');
    return {
      nr: idx + 1,
      bezeichnung: p.bezeichnung,
      beschreibung: (p.unterzeilen ?? []).map((z) => z.trim()).filter(Boolean).join('\n') || null,
      menge: Number(p.menge),
      einheitCode: p.einheit_code ?? 'C62',
      einzelpreis: Number(p.einzelpreis),
      netto: Number(p.gesamtpreis),
      ustSatz: satz,
      kategorie: kat,
    };
  });
  if (sortiert.some((p) => p.zusatz_id)) {
    hinweise.push({
      bt: 'BG-25', schwere: 'hinweis',
      text: 'Enthält Zusatz-Positionen (z.B. Auslagen) mit dem Steuersatz der Rechnung — steuerliche Behandlung offen (Frage S3).',
    });
  }

  // ---- Summen: derselbe Aufruf wie für das PDF ----
  const sum = berechneSummenProUst(
    sortiert.map((p) => ({ gesamtpreis: Number(p.gesamtpreis), ust_satz: p.ust_satz == null ? null : Number(p.ust_satz) })),
    defaultSatz,
  );

  // ---- Käufer-Adresse ----
  let plz = r.rechnungsadresse_plz ?? null;
  let ort = r.rechnungsadresse_ort ?? null;
  if ((plz || ort) && !gleicheAdresszeile([plz, ort].filter(Boolean).join(' '), r.rechnungsadresse_plz_ort)) {
    hinweise.push({
      bt: 'BT-52/53', schwere: 'fehler',
      text: `PLZ/Ort (${[plz, ort].filter(Boolean).join(' ')}) weichen vom Adressfeld der Rechnung ab („${r.rechnungsadresse_plz_ort ?? ''}").`,
    });
  }
  if (!plz && !ort && test) {
    const v = trennePlzOrt(r.rechnungsadresse_plz_ort, r.rechnungsadresse_land);
    if (v.status === 'eindeutig') {
      plz = v.plz; ort = v.ort;
      hinweise.push({ bt: 'BT-52/53', schwere: 'hinweis', text: `PLZ/Ort für den Test aus „${r.rechnungsadresse_plz_ort}" abgeleitet (Rechnung vor Migration 115).` });
    }
  }
  let landCode = normLandCode(r.rechnungsadresse_land_code);
  if (!landCode && test) {
    landCode = landZuIso(r.rechnungsadresse_land);
    if (landCode) {
      hinweise.push({ bt: 'BT-55', schwere: 'hinweis', text: `Ländercode ${landCode} für den Test aus „${r.rechnungsadresse_land || '(leer)'}" abgeleitet.` });
    }
  }

  let email = r.erechnung_email ?? null;
  let referenz = r.kaeufer_referenz ?? null;
  if (test && !manuell && ag) {
    if (!email && ag.erechnung_email) {
      email = ag.erechnung_email;
      hinweise.push({ bt: 'BT-49', schwere: 'hinweis', text: 'E-Rechnungs-Adresse für den Test aus den aktuellen Auftraggeber-Stammdaten.' });
    }
    if (!referenz && ag.kaeufer_referenz) {
      referenz = ag.kaeufer_referenz;
      hinweise.push({ bt: 'BT-10', schwere: 'hinweis', text: 'Käuferreferenz für den Test aus den aktuellen Auftraggeber-Stammdaten.' });
    }
  }

  // ---- Zahlungsziel / Fälligkeit (wie PDF: Datum + Zahlungsziel) ----
  const ziel = r.zahlungsziel_tage ?? (manuell ? null : ag?.zahlungsziel_tage ?? null);
  const faellig = r.faellig_am ?? (ziel != null && r.datum ? plusTage(r.datum, Number(ziel)) : null);

  const firmaName = (r.rechnungsadresse_firma ?? '').trim();
  const ansprechpartner = (r.ansprechpartner ?? '').trim();

  const daten: ERechnungDaten = {
    typ: '380',
    nummer: r.rechnungsnummer,
    datum: r.datum,
    faelligAm: faellig,
    zahlungszielTage: ziel,
    leistungVon: r.leistungszeitraum_von ?? null,
    leistungBis: r.leistungszeitraum_bis ?? null,
    waehrung: 'EUR',
    kaeuferReferenz: referenz,
    notizen: ['Leistungsdatum = Datum des Fahrauftrages'],
    verkaeufer: {
      name: firma.name,
      strasse: firma.strasse,
      plz: firma.plz,
      ort: firma.ort,
      landCode: firma.landCode,
      ustId: firma.ustId,
      steuernummer: firma.steuernummer,
      kontaktName: firma.kontaktName,
      telefon: firma.telefon,
      email: firma.email,
      elektronischeAdresse: firma.email,
      iban: firma.iban,
      bic: firma.bic,
    },
    kaeufer: {
      name: firmaName || ansprechpartner,
      strasse: r.rechnungsadresse_strasse ?? null,
      plz, ort, landCode,
      ustId: manuell ? (r.empfaenger_ust_id ?? null) : (ag?.kunden_uid ?? null),
      kennung: r.kundennummer ?? null,
      kontaktName: firmaName && ansprechpartner ? ansprechpartner : null,
      elektronischeAdresse: email,
    },
    positionen,
    summen: {
      gruppen: sum.groups.map((g) => ({ kategorie: g.satz > 0 ? 'S' : 'unbestimmt', satz: g.satz, netto: g.netto, ust: g.ust })),
      netto: sum.netto,
      ust: sum.ust,
      brutto: sum.brutto,
    },
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
