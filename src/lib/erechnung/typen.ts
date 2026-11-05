// E-Rechnung: neutrales Datenmodell zwischen Rechnung (Datenbank) und
// XML. Alle Beträge kommen fertig berechnet hinein — der Generator
// rechnet NICHTS nach, er schreibt nur (siehe ausRechnung.ts: dieselbe
// Summenfunktion wie das PDF).

/** Zielprofil der XML-Datei. */
export type ERechnungProfil = 'xrechnung' | 'en16931';

/** Spezifikations-Kennungen (BT-24). */
export const PROFIL_KENNUNG: Record<ERechnungProfil, string> = {
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
  en16931: 'urn:cen.eu:en16931:2017',
};

/** Geschäftsprozess (BT-23) — von XRechnung empfohlen. */
export const PROZESS_KENNUNG = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

export interface ERechnungPartei {
  name: string;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  /** ISO 3166-1 alpha-2. */
  landCode: string | null;
  ustId: string | null;
  steuernummer?: string | null;
  /** Kennung beim Verkäufer (Kundennummer, BT-46). */
  kennung?: string | null;
  kontaktName?: string | null;
  telefon?: string | null;
  email?: string | null;
  /** Elektronische Adresse (BT-34 / BT-49), hier E-Mail (Schema „EM"). */
  elektronischeAdresse: string | null;
}

export interface ERechnungPosition {
  nr: number;
  bezeichnung: string;
  /** Unterzeilen des PDFs, zeilenweise (BT-154). */
  beschreibung: string | null;
  menge: number;
  /** UN/ECE Rec. 20, z.B. C62. */
  einheitCode: string;
  einzelpreis: number;
  /** Netto der Position — exakt der gespeicherte Gesamtpreis. */
  netto: number;
  ustSatz: number;
  /** UNCL 5305 — vorerst nur 'S'. */
  kategorie: string;
}

export interface ERechnungSteuerGruppe {
  kategorie: string;
  satz: number;
  netto: number;
  ust: number;
}

export interface ERechnungDaten {
  /** UNTDID 1001 — vorerst nur 380 (Rechnung). */
  typ: '380';
  nummer: string;
  /** YYYY-MM-DD */
  datum: string;
  faelligAm: string | null;
  zahlungszielTage: number | null;
  leistungVon: string | null;
  leistungBis: string | null;
  waehrung: 'EUR';
  kaeuferReferenz: string | null;
  notizen: string[];
  verkaeufer: ERechnungPartei & { iban: string; bic: string | null };
  kaeufer: ERechnungPartei;
  positionen: ERechnungPosition[];
  summen: {
    gruppen: ERechnungSteuerGruppe[];
    netto: number;
    ust: number;
    brutto: number;
  };
}

/** Abbruch mit klarer Meldung (Dokumentart/Steuerfall nicht freigegeben). */
export class ERechnungAbbruch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERechnungAbbruch';
  }
}
