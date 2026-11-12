// Korrekturen einer erstellten Rechnung (S1/S10):
//   * Storno       — Stornorechnung über den vollen Betrag (RPC, atomar),
//                    Original → 'storniert'; bei E-Rechnungs-Empfängern
//                    sofort als E-Rechnung (Typ TYP_CODE_KORREKTUR).
//   * Teilgutschrift — ausgewählte Positionen/Beträge als Entwurf im
//                    Gutschriften-Modul; E-Rechnung beim Finalisieren.
//   * Als neue Rechnung übernehmen — Kopie einer stornierten Rechnung als
//                    neuer Entwurf (neue Nummer vergibt die Datenbank).
// Beträge immer positiv (keine negativen Einzelpreise, BR-27).

import { supabase } from '../supabase';
import { berechneSummenProUst } from '../rechnungsformat';
import type { Database, Json } from '../../types/supabase';
import type { ERechnungDokument } from '../onedrive';
import { gutschriftERechnungErzeugen, gutschriftVorpruefung, sperrMeldung } from './erstellen';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];

export interface StornoErgebnis {
  gutschriftId: string;
  erechnung: ERechnungDokument | null;
  /** E-Rechnung sollte entstehen, ist aber gescheitert (Storno besteht trotzdem). */
  erechnungFehler: string | null;
}

export async function rechnungStornieren(rechnungId: string): Promise<StornoErgebnis> {
  const { data, error } = await supabase.rpc('rechnung_stornieren', { p_rechnung_id: rechnungId });
  if (error) throw new Error(sperrMeldung(error.message.replace(/^STORNO_NICHT_MOEGLICH:\s*/, '')));
  const gutschriftId = data as unknown as string;
  const vp = await gutschriftVorpruefung(gutschriftId).catch(() => null);
  if (!vp) return { gutschriftId, erechnung: null, erechnungFehler: null };
  try {
    const { dokument } = await gutschriftERechnungErzeugen(gutschriftId);
    return { gutschriftId, erechnung: dokument, erechnungFehler: null };
  } catch (e) {
    return { gutschriftId, erechnung: null, erechnungFehler: e instanceof Error ? e.message : String(e) };
  }
}

export interface TeilgutschriftAuswahl {
  positionId: string;
  menge: number;
  einzelpreis: number;
}

function adressSnapshot(r: RechnungRow): Json {
  return {
    firma: r.rechnungsadresse_firma, ansprechpartner: r.ansprechpartner, strasse: r.rechnungsadresse_strasse,
    plz_ort: r.rechnungsadresse_plz_ort, land: r.rechnungsadresse_land,
    plz: r.rechnungsadresse_plz ?? null, ort: r.rechnungsadresse_ort ?? null, land_code: r.rechnungsadresse_land_code ?? null,
  };
}

/** Prüft die Auswahl gegen die Originalpositionen. Leer = ok. */
export function pruefeTeilgutschrift(original: PositionRow[], auswahl: TeilgutschriftAuswahl[]): string[] {
  const fehler: string[] = [];
  if (auswahl.length === 0) fehler.push('Bitte mindestens eine Position auswählen.');
  for (const a of auswahl) {
    const p = original.find((x) => x.id === a.positionId);
    if (!p) { fehler.push('Unbekannte Position.'); continue; }
    if (!(a.menge > 0) || !(a.einzelpreis > 0)) fehler.push(`Position „${p.bezeichnung}": Menge und Betrag müssen größer als 0 sein.`);
    if (Math.round(a.menge * a.einzelpreis * 100) > Math.round(Number(p.gesamtpreis) * 100)) {
      fehler.push(`Position „${p.bezeichnung}": Gutschrift höher als der Rechnungsbetrag der Position.`);
    }
  }
  return fehler;
}

/** Legt eine Teilgutschrift als ENTWURF an (Bearbeiten/Finalisieren im Gutschriften-Modul). */
export async function teilgutschriftAnlegen(rechnung: RechnungRow, original: PositionRow[], auswahl: TeilgutschriftAuswahl[]): Promise<string> {
  const fehler = pruefeTeilgutschrift(original, auswahl);
  if (fehler.length) throw new Error(fehler.join(' '));
  const zeilen = auswahl.map((a, i) => {
    const p = original.find((x) => x.id === a.positionId)!;
    const gesamt = Math.round(a.menge * a.einzelpreis * 100) / 100;
    return { p, row: {
      position_nr: i + 1, bezeichnung: p.bezeichnung, unterzeilen: (p.unterzeilen ?? []) as unknown as Json,
      menge: a.menge, einzelpreis: a.einzelpreis, gesamtpreis: gesamt, ust_satz: p.ust_satz, tour_id: p.tour_id,
      ist_manuell: p.ist_manuell,
    } };
  });
  const sum = berechneSummenProUst(zeilen.map((z) => ({ gesamtpreis: z.row.gesamtpreis, ust_satz: z.row.ust_satz })), Number(rechnung.ust_satz) || 0);
  const { data: g, error } = await supabase.from('gutschriften').insert({
    art: 'teilgutschrift', rechnung_id: rechnung.id,
    bezug_rechnungsnummer: rechnung.rechnungsnummer, bezug_rechnungsdatum: rechnung.datum,
    auftraggeber_id: rechnung.auftraggeber_id, rechnungsempfaenger_id: rechnung.rechnungsempfaenger_id,
    datum: new Date().toISOString().slice(0, 10),
    leistungszeitraum_von: rechnung.leistungszeitraum_von, leistungszeitraum_bis: rechnung.leistungszeitraum_bis,
    anrede: rechnung.anrede,
    einleitungstext: `Zur Rechnung ${rechnung.rechnungsnummer} schreiben wir Ihnen folgende Beträge gut:`,
    adress_snapshot: adressSnapshot(rechnung), kundennummer: rechnung.kundennummer, sachbearbeiter: rechnung.sachbearbeiter,
    ust_satz: rechnung.ust_satz, netto_summe: sum.netto, ust_summe: sum.ust, brutto_summe: sum.brutto, status: 'entwurf',
    empfaenger_typ: rechnung.empfaenger_typ, empfaenger_email: rechnung.empfaenger_email, empfaenger_ust_id: rechnung.empfaenger_ust_id,
    mit_unterschrift: rechnung.mit_unterschrift, mit_stempel: rechnung.mit_stempel,
    erechnung_format: rechnung.erechnung_format ?? 'pdf', erechnung_email: rechnung.erechnung_email, kaeufer_referenz: rechnung.kaeufer_referenz,
  }).select('id').single();
  if (error || !g) throw new Error(error?.message ?? 'Teilgutschrift konnte nicht angelegt werden.');
  const { data: neu, error: pErr } = await supabase.from('gutschriftspositionen')
    .insert(zeilen.map((z) => ({ ...z.row, gutschrift_id: g.id }))).select('id, position_nr');
  if (pErr) throw new Error(pErr.message);
  // Leistungsdatum wie auf der Originalrechnung (nicht das heutige Tour-Datum).
  for (const n of neu ?? []) {
    const z = zeilen[n.position_nr - 1];
    if (z?.p.leistungsdatum) await supabase.from('gutschriftspositionen').update({ leistungsdatum: z.p.leistungsdatum }).eq('id', n.id);
  }
  return g.id;
}

/** Kopie einer stornierten Rechnung als neuer Entwurf (gleiche Positionen, neue Nummer). */
export async function alsNeueRechnungUebernehmen(rechnungId: string): Promise<string> {
  const [rRes, pRes] = await Promise.all([
    supabase.from('rechnungen').select('*').eq('id', rechnungId).single(),
    supabase.from('rechnungspositionen').select('*').eq('rechnung_id', rechnungId).order('position_nr'),
  ]);
  if (rRes.error) throw new Error(rRes.error.message);
  if (pRes.error) throw new Error(pRes.error.message);
  const r = rRes.data as RechnungRow;
  if (r.status !== 'storniert') throw new Error('Nur stornierte Rechnungen lassen sich als neue Rechnung übernehmen.');
  const { data: neu, error } = await supabase.from('rechnungen').insert({
    auftraggeber_id: r.auftraggeber_id, empfaenger_typ: r.empfaenger_typ, empfaenger_email: r.empfaenger_email,
    // Niederlassung (Migration 118) übernehmen; ohne Migration ist das Feld undefined und entfällt.
    niederlassung_id: r.niederlassung_id,
    empfaenger_ust_id: r.empfaenger_ust_id, rechnungsadresse_id: null,
    datum: new Date().toISOString().slice(0, 10),
    leistungszeitraum_von: r.leistungszeitraum_von, leistungszeitraum_bis: r.leistungszeitraum_bis,
    anrede: r.anrede, netto_summe: r.netto_summe, ust_satz: r.ust_satz, ust_betrag: r.ust_betrag, brutto_summe: r.brutto_summe,
    status: 'entwurf', notizen: `Übernommen aus stornierter Rechnung ${r.rechnungsnummer}.`,
    ist_auslagen_rechnung: r.ist_auslagen_rechnung, ansprechpartner: r.ansprechpartner, sachbearbeiter: r.sachbearbeiter,
    kundennummer: r.kundennummer, rechnungsadresse_firma: r.rechnungsadresse_firma, rechnungsadresse_strasse: r.rechnungsadresse_strasse,
    rechnungsadresse_plz_ort: r.rechnungsadresse_plz_ort, rechnungsadresse_land: r.rechnungsadresse_land,
    rechnungsempfaenger_id: r.rechnungsempfaenger_id, mit_unterschrift: r.mit_unterschrift, mit_stempel: r.mit_stempel,
    zahlungsziel_tage: r.empfaenger_typ === 'manuell' ? r.zahlungsziel_tage : null,
    rechnungsadresse_plz: r.rechnungsadresse_plz, rechnungsadresse_ort: r.rechnungsadresse_ort,
    rechnungsadresse_land_code: r.rechnungsadresse_land_code,
    erechnung_format: r.empfaenger_typ === 'manuell' ? r.erechnung_format : null,
    erechnung_email: r.erechnung_email, kaeufer_referenz: r.kaeufer_referenz,
  }).select('id').single();
  if (error || !neu) throw new Error(error?.message ?? 'Neue Rechnung konnte nicht angelegt werden.');
  const pos = (pRes.data ?? []) as PositionRow[];
  if (pos.length) {
    const { error: pErr } = await supabase.from('rechnungspositionen').insert(pos.map((p) => ({
      rechnung_id: neu.id, position_nr: p.position_nr, bezeichnung: p.bezeichnung, unterzeilen: p.unterzeilen,
      menge: p.menge, einzelpreis: p.einzelpreis, gesamtpreis: p.gesamtpreis, tour_id: p.tour_id, zusatz_id: p.zusatz_id,
      ist_manuell: p.ist_manuell, ust_satz: p.ust_satz,
    })));
    if (pErr) throw new Error(pErr.message);
  }
  return neu.id;
}
