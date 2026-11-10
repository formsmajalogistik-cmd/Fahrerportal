// Beleg (Rechnung bzw. Gutschrift) → Eingabe für das PDF.
//
// EINE Abbildung für das normale PDF („PDF neu generieren") und für die
// PDF-Lesekopie der E-Rechnung. Die Lesekopie bekommt zusätzlich die
// Angaben aus dem XML (Referenz, Leistungszeitraum, Leistungsdatum je
// Position, Ansprechpartner, Fälligkeit) — aus demselben
// ERechnungDaten-Objekt, aus dem das XML entsteht.

import type { Database } from '../../types/supabase';
import type { Firmendaten } from '../firmendaten';
import type { RechnungPdfInput, RechnungPdfPosition } from '../../pages/admin/rechnungen/rechnungPdf';
import type { ERechnungDaten } from './typen';
import { STORNO_TITEL } from './texte';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];
type GutschriftRow = Database['public']['Tables']['gutschriften']['Row'];
type GutschriftPositionRow = Database['public']['Tables']['gutschriftspositionen']['Row'];

interface Gemeinsam {
  firma: Firmendaten;
  /** true = Firmendaten aus dem Snapshot des Belegs. */
  ausSnapshot: boolean;
  /** Gesetzt = PDF-Lesekopie einer E-Rechnung. */
  erechnung?: ERechnungDaten | null;
  bilder?: { unterschrift: string | null; stempel: string | null };
  /** ZUGFeRD: PDF/A-3 mit eingebettetem XML (setzt `erechnung` voraus). */
  zugferd?: RechnungPdfInput['zugferd'];
}

function datumDe(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

function lesekopie(d: ERechnungDaten | null | undefined): RechnungPdfInput['lesekopie'] {
  if (!d) return null;
  return { kaeuferReferenz: d.kaeuferReferenz, leistungVon: d.leistungVon, leistungBis: d.leistungBis, kontaktName: d.verkaeufer.kontaktName ?? null };
}

export function rechnungPdfInputAus(args: Gemeinsam & {
  rechnung: RechnungRow;
  positionen: PositionRow[];
  auftraggeber: { kunden_uid: string | null; zahlungsziel_tage: number | null } | null;
  /** Rechnungsadresse (Alt-Rechnungen ohne Snapshot-Spalten). */
  rechnungsadresse?: { firma: string | null; ansprechpartner: string | null; strasse: string | null; plz_ort: string | null; land: string | null } | null;
}): RechnungPdfInput {
  const r = args.rechnung;
  const ra = args.rechnungsadresse ?? null;
  const manuell = r.empfaenger_typ === 'manuell';
  const e = args.erechnung ?? null;

  // Zahlungsziel/Fälligkeit: normales PDF wie bisher NUR bei Auftraggeber-
  // Rechnungen; die Lesekopie zeigt immer, was im XML steht.
  let zahlungsziel: number | null;
  let faelligAm: string | null = null;
  if (e) {
    zahlungsziel = e.zahlungszielTage;
    faelligAm = e.faelligAm;
  } else {
    zahlungsziel = manuell ? null : (r.zahlungsziel_tage ?? args.auftraggeber?.zahlungsziel_tage ?? null);
    if (zahlungsziel != null && Number.isFinite(zahlungsziel) && r.datum) {
      const d = new Date(`${r.datum}T12:00:00`);
      d.setDate(d.getDate() + Number(zahlungsziel));
      faelligAm = r.faellig_am ?? d.toISOString().slice(0, 10);
    }
  }

  const positionen: RechnungPdfPosition[] = [...args.positionen]
    .sort((a, b) => a.position_nr - b.position_nr)
    .map((p, idx) => ({
      position_nr: idx + 1,
      bezeichnung: p.bezeichnung,
      unterzeilen: p.unterzeilen ?? [],
      menge: Number(p.menge),
      einzelpreis: Number(p.einzelpreis),
      gesamtpreis: Number(p.gesamtpreis),
      ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
      leistungsdatum: p.leistungsdatum ?? null,
    }));

  return {
    rechnungsnummer: r.rechnungsnummer,
    datum: r.datum,
    anrede: r.anrede,
    kundennummer: r.kundennummer,
    sachbearbeiter: r.sachbearbeiter,
    faelligAm,
    empfaenger: {
      firma:           r.rechnungsadresse_firma   ?? ra?.firma           ?? null,
      ansprechpartner: r.ansprechpartner          ?? ra?.ansprechpartner ?? null,
      strasse:         r.rechnungsadresse_strasse ?? ra?.strasse         ?? null,
      plz_ort:         r.rechnungsadresse_plz_ort ?? ra?.plz_ort         ?? null,
      land:            r.rechnungsadresse_land    ?? ra?.land            ?? null,
    },
    // Manuelle Rechnungen: USt-IdNr. aus dem Empfänger-Feld.
    kundenUid: manuell ? (r.empfaenger_ust_id ?? null) : (args.auftraggeber?.kunden_uid ?? null),
    zahlungszielTage: zahlungsziel,
    ustSatzDefault: Number(r.ust_satz) || 0,
    positionen,
    absender: args.firma,
    pflichtangaben: args.ausSnapshot || r.status === 'entwurf',
    lesekopie: lesekopie(e),
    zugferd: e ? (args.zugferd ?? null) : null,
    absenderUnterschrift: args.bilder?.unterschrift ?? null,
    absenderStempel: args.bilder?.stempel ?? null,
  };
}

export function gutschriftPdfInputAus(args: Gemeinsam & {
  gutschrift: GutschriftRow;
  positionen: GutschriftPositionRow[];
  auftraggeber: { kunden_uid: string | null } | null;
  /** Konfigurierte Bezeichnung (Gutschrift-Einstellungen). */
  dokumentbezeichnung: string;
  summenLabel: string;
  /** Bezug als Text (Nummer + Datum), falls die Rechnung verknüpft ist. */
  bezugRechnung?: { nummer: string; datum: string } | null;
}): RechnungPdfInput {
  const g = args.gutschrift;
  const a = (g.adress_snapshot && typeof g.adress_snapshot === 'object' ? g.adress_snapshot : {}) as Record<string, string | null>;
  const bezugNr = g.bezug_rechnungsnummer ?? args.bezugRechnung?.nummer ?? null;
  const bezugDatum = g.bezug_rechnungsdatum ?? args.bezugRechnung?.datum ?? null;
  const bezug = bezugNr ? `Bezug: Rechnung ${bezugNr}${bezugDatum ? ` vom ${datumDe(bezugDatum)}` : ''}` : null;
  const zeitraum = (g.leistungszeitraum_von || g.leistungszeitraum_bis)
    ? `Leistungszeitraum: ${datumDe(g.leistungszeitraum_von ?? g.leistungszeitraum_bis)}`
      + (g.leistungszeitraum_von && g.leistungszeitraum_bis && g.leistungszeitraum_von !== g.leistungszeitraum_bis
        ? ` – ${datumDe(g.leistungszeitraum_bis)}` : '')
    : null;
  const titel = g.art === 'storno' ? STORNO_TITEL : args.dokumentbezeichnung;
  const e = args.erechnung ?? null;
  return {
    dokumentTitel: titel,
    rechnungsnummer: g.gutschrift_nr,
    datum: g.datum,
    anrede: g.anrede,
    kundennummer: g.kundennummer,
    sachbearbeiter: g.sachbearbeiter,
    faelligAm: null,
    zahlungszielTage: null,
    bezugszeile: [bezug, e ? null : zeitraum].filter(Boolean).join('   ·   ') || null,
    einleitungstext: g.einleitungstext,
    schlusstext: g.schlusstext,
    summenLabel: args.summenLabel,
    empfaenger: {
      firma: a.firma ?? null, ansprechpartner: a.ansprechpartner ?? null, strasse: a.strasse ?? null,
      plz_ort: a.plz_ort ?? null, land: a.land ?? null,
    },
    kundenUid: g.empfaenger_typ === 'manuell' ? (g.empfaenger_ust_id ?? null) : (args.auftraggeber?.kunden_uid ?? null),
    ustSatzDefault: Number(g.ust_satz) || 0,
    positionen: [...args.positionen].sort((x, y) => x.position_nr - y.position_nr).map((p, idx) => ({
      position_nr: idx + 1,
      bezeichnung: p.bezeichnung,
      unterzeilen: Array.isArray(p.unterzeilen) ? (p.unterzeilen as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      menge: Number(p.menge),
      einzelpreis: Number(p.einzelpreis),
      gesamtpreis: Number(p.gesamtpreis),
      ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
      leistungsdatum: p.leistungsdatum ?? null,
    })),
    absender: args.firma,
    pflichtangaben: args.ausSnapshot || g.status === 'entwurf',
    lesekopie: lesekopie(e),
    zugferd: e ? (args.zugferd ?? null) : null,
    absenderUnterschrift: args.bilder?.unterschrift ?? null,
    absenderStempel: args.bilder?.stempel ?? null,
  };
}
