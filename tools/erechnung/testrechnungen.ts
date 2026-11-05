// Synthetische Testrechnungen für die E-Rechnung — KEINE echten Kundendaten.
//
// Jede Testrechnung ist als Datenbank-Zeile modelliert (wie sie aus
// Supabase käme) und läuft durch genau denselben Weg wie später die
// echte Rechnung: bildeERechnung() → erzeugeCii().
//
// Absender: die echten Firmendaten (src/lib/firmendaten.ts), jedoch mit
// einem Platzhalter-Kontaktnamen — der echte Kontaktname ist noch nicht
// hinterlegt (Pflicht bei XRechnung, BR-DE-5).

import type { Database } from '../../src/types/supabase';
import { FIRMENDATEN, type Firmendaten } from '../../src/lib/firmendaten';
import type { ERechnungQuelle } from '../../src/lib/erechnung/ausRechnung';
import type { ERechnungProfil } from '../../src/lib/erechnung/typen';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];

export const TEST_FIRMA: Firmendaten = { ...FIRMENDATEN, kontaktName: 'Testkontakt (Platzhalter)' };

export interface Testrechnung {
  name: string;
  beschreibung: string;
  profil: ERechnungProfil;
  quelle: ERechnungQuelle;
  /** Erwartetes Ergebnis des Validators. */
  erwartung: 'gueltig' | 'ungueltig';
  /** Bei 'ungueltig': diese Regel-IDs müssen gemeldet werden. */
  erwarteteRegeln?: string[];
}

let posZaehler = 0;
function pos(rechnungId: string, nr: number, p: Partial<PositionRow> & Pick<PositionRow, 'bezeichnung' | 'menge' | 'einzelpreis' | 'gesamtpreis'>): PositionRow {
  posZaehler += 1;
  return {
    id: `p-${posZaehler}`,
    rechnung_id: rechnungId,
    position_nr: nr,
    unterzeilen: [],
    tour_id: null,
    zusatz_id: null,
    ist_manuell: false,
    ust_satz: null,
    created_at: '2026-11-03T10:00:00Z',
    einheit_code: null,
    steuerkategorie: null,
    befreiungsgrund_code: null,
    befreiungsgrund_text: null,
    ...p,
  };
}

function rechnung(id: string, p: Partial<RechnungRow>): RechnungRow {
  return {
    mit_unterschrift: true,
    mit_stempel: true,
    id,
    rechnungsnummer: 'Re_26/9001',
    auftraggeber_id: 'ag-test',
    rechnungsadresse_id: null,
    datum: '2026-11-03',
    leistungszeitraum_von: '2026-10-01',
    leistungszeitraum_bis: '2026-10-31',
    anrede: 'Sehr geehrte Damen und Herren,',
    netto_summe: 0,
    ust_satz: 19,
    ust_betrag: 0,
    brutto_summe: 0,
    status: 'offen',
    bezahlt_am: null,
    pdf_url: null,
    belege_pdf_url: null,
    email_versendet_am: null,
    notizen: null,
    ist_auslagen_rechnung: false,
    ansprechpartner: 'Frau Erika Beispiel',
    sachbearbeiter: null,
    kundennummer: 'K-TEST-1',
    rechnungsadresse_firma: 'Beispiel Autovermietung GmbH',
    rechnungsadresse_strasse: 'Musterstraße 12',
    rechnungsadresse_plz_ort: '28195 Bremen',
    rechnungsadresse_land: null,
    empfaenger_typ: 'auftraggeber',
    empfaenger_email: null,
    empfaenger_ust_id: null,
    rechnungsempfaenger_id: null,
    created_at: '2026-11-03T10:00:00Z',
    updated_at: '2026-11-03T10:00:00Z',
    faellig_am: '2026-11-17',
    zahlungsziel_tage: 14,
    rechnungsadresse_plz: '28195',
    rechnungsadresse_ort: 'Bremen',
    rechnungsadresse_land_code: 'DE',
    erechnung_format: 'xrechnung_cii',
    erechnung_email: 'rechnungseingang@example.com',
    kaeufer_referenz: 'BESTELLUNG-4711',
    ...p,
  };
}

const AG = { kunden_uid: 'DE123456789', zahlungsziel_tage: 14, erechnung_email: null, kaeufer_referenz: null, land_code: 'DE' };

export function testrechnungen(): Testrechnung[] {
  const liste: Testrechnung[] = [];

  // 1) einfache AB-Tour
  {
    const r = rechnung('r1', { rechnungsnummer: 'Re_26/9001' });
    liste.push({
      name: '01_ab_tour', profil: 'xrechnung', erwartung: 'gueltig',
      beschreibung: 'Einfache AB-Tour, eine Position, 19 %',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r1', 1, { bezeichnung: 'Überführung Bremen nach Hamburg', unterzeilen: ['HB-XY 123', 'Fahrauftrag vom 14.10.2026'], menge: 1, einzelpreis: 192, gesamtpreis: 192, tour_id: 't1' }),
      ] },
    });
  }

  // 2) ABA-Tour — Aufschlag ist im Positionspreis enthalten (192 + 10 % = 211,20)
  {
    const r = rechnung('r2', { rechnungsnummer: 'Re_26/9002' });
    liste.push({
      name: '02_aba_tour', profil: 'xrechnung', erwartung: 'gueltig',
      beschreibung: 'ABA-Tour, Aufschlag im Positionspreis',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r2', 1, { bezeichnung: 'Bremen – Kiel – Bremen', unterzeilen: ['ABA HB-XY 1/KI-AB 2', 'Fahrauftrag vom 20.10.2026'], menge: 1, einzelpreis: 211.2, gesamtpreis: 211.2, tour_id: 't2' }),
        pos('r2', 2, { bezeichnung: 'Überführung Bremen nach Oldenburg', unterzeilen: ['HB-XY 9'], menge: 1, einzelpreis: 98.5, gesamtpreis: 98.5, tour_id: 't3' }),
      ] },
    });
  }

  // 3) zwei Steuersätze (beide Kategorie S)
  {
    const r = rechnung('r3', { rechnungsnummer: 'Re_26/9003' });
    liste.push({
      name: '03_zwei_steuersaetze', profil: 'xrechnung', erwartung: 'gueltig',
      beschreibung: 'Positionen mit 19 % und 7 % (synthetisch; steuerliche Einordnung offen)',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r3', 1, { bezeichnung: 'Überführung Bremen nach Hannover', menge: 1, einzelpreis: 180, gesamtpreis: 180, tour_id: 't4' }),
        pos('r3', 2, { bezeichnung: 'Leistung zum ermäßigten Satz (Test)', menge: 2, einzelpreis: 25.55, gesamtpreis: 51.1, ust_satz: 7 }),
        pos('r3', 3, { bezeichnung: 'Wartezeit', menge: 1.5, einzelpreis: 30, gesamtpreis: 45, ust_satz: 19, einheit_code: 'HUR' }),
      ] },
    });
  }

  // 4) manuelle Rechnung mit eigenem Zahlungsziel
  {
    const r = rechnung('r4', {
      rechnungsnummer: 'Re_26/9004', empfaenger_typ: 'manuell', auftraggeber_id: null,
      rechnungsadresse_firma: 'Test Transporte UG (haftungsbeschränkt)', ansprechpartner: 'Herr Max Mustermann',
      rechnungsadresse_strasse: 'Am Hafen 5', rechnungsadresse_plz_ort: '26122 Oldenburg',
      rechnungsadresse_plz: '26122', rechnungsadresse_ort: 'Oldenburg',
      empfaenger_ust_id: 'DE987654321', kundennummer: 'M-7',
      zahlungsziel_tage: 10, faellig_am: '2026-11-13',
      erechnung_email: 'buchhaltung@example.org', kaeufer_referenz: 'M-7',
    });
    liste.push({
      name: '04_manuell_zahlungsziel', profil: 'xrechnung', erwartung: 'gueltig',
      beschreibung: 'Manueller Empfänger, Zahlungsziel 10 Tage',
      quelle: { rechnung: r, auftraggeber: null, positionen: [
        pos('r4', 1, { bezeichnung: 'Fahrerstellung', menge: 8, einzelpreis: 35, gesamtpreis: 280, ist_manuell: true, einheit_code: 'HUR' }),
      ] },
    });
  }

  // 5) Sonderzeichen in Namen/Adressen
  {
    const r = rechnung('r5', {
      rechnungsnummer: 'Re_26/9005',
      rechnungsadresse_firma: 'Müller & Söhne <Logistik> "Nord" GmbH',
      ansprechpartner: "Frau Zoë O'Brien-Jäger",
      rechnungsadresse_strasse: 'Königsallee 1 & 2 <Hinterhaus>',
      rechnungsadresse_plz_ort: '40212 Düsseldorf',
      rechnungsadresse_plz: '40212', rechnungsadresse_ort: 'Düsseldorf',
      kaeufer_referenz: 'Ref "A&B" <1>',
      erechnung_email: 'e-rechnung@mueller-soehne.example',
    });
    liste.push({
      name: '05_sonderzeichen', profil: 'xrechnung', erwartung: 'gueltig',
      beschreibung: 'Umlaute, &, <, >, " und \' in Namen, Adressen, Texten',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r5', 1, { bezeichnung: 'Überführung „Bremen" → <Kiel> & zurück', unterzeilen: ["Kennzeichen HB-ÄÖ 12 & 'KI-ÜX 3'", 'Hinweis: 5 > 3 < 7'], menge: 1, einzelpreis: 250, gesamtpreis: 250 }),
      ] },
    });
  }

  // 6) wie 1, aber Profil EN 16931 (ohne XRechnung-Zusatzregeln, z.B. für ZUGFeRD später)
  {
    const r = rechnung('r6', { rechnungsnummer: 'Re_26/9006', kaeufer_referenz: null, erechnung_email: null });
    liste.push({
      name: '06_en16931_ohne_xrechnung', profil: 'en16931', erwartung: 'gueltig',
      beschreibung: 'Profil EN 16931 ohne Käuferreferenz/E-Rechnungs-Adresse',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r6', 1, { bezeichnung: 'Überführung Bremen nach Hamburg', menge: 1, einzelpreis: 192, gesamtpreis: 192 }),
      ] },
    });
  }

  // 7) Gegenprobe: XRechnung ohne Käuferreferenz — MUSS abgelehnt werden
  {
    const r = rechnung('r7', { rechnungsnummer: 'Re_26/9007', kaeufer_referenz: null });
    liste.push({
      name: '07_gegenprobe_ohne_kaeuferreferenz', profil: 'xrechnung', erwartung: 'ungueltig',
      erwarteteRegeln: ['BR-DE-15'],
      beschreibung: 'Gegenprobe: fehlende Käuferreferenz muss erkannt werden',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r7', 1, { bezeichnung: 'Überführung', menge: 1, einzelpreis: 100, gesamtpreis: 100 }),
      ] },
    });
  }

  // 8) Gegenprobe: echte Firmendaten ohne Kontaktnamen — MUSS abgelehnt werden
  {
    const r = rechnung('r8', { rechnungsnummer: 'Re_26/9008' });
    liste.push({
      name: '08_gegenprobe_ohne_kontaktname', profil: 'xrechnung', erwartung: 'ungueltig',
      erwarteteRegeln: ['BR-DE-5'],
      beschreibung: 'Gegenprobe: echte Firmendaten (Kontaktname fehlt) — zeigt die Lücke',
      quelle: { rechnung: r, auftraggeber: AG, positionen: [
        pos('r8', 1, { bezeichnung: 'Überführung', menge: 1, einzelpreis: 100, gesamtpreis: 100 }),
      ] },
    });
  }

  return liste;
}

/** Testrechnungen, die mit den echten (unvollständigen) Firmendaten laufen. */
export const MIT_ECHTEN_FIRMENDATEN = new Set(['08_gegenprobe_ohne_kontaktname']);
