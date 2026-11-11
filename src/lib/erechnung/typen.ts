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

/**
 * Dokumentart (UNTDID 1001, BT-3).
 *   380 = Rechnung
 *   381 = Gutschrift/Korrektur — für Stornorechnung und Teilgutschrift.
 * TYP_CODE_KORREKTUR ist die EINE Stelle für den Code der Korrekturbelege;
 * er wird noch vom Steuerberater bestätigt (Alternative wäre z.B. 384).
 */
export const TYP_CODE_RECHNUNG = '380';
export const TYP_CODE_KORREKTUR = '381';
export type ERechnungTypCode = typeof TYP_CODE_RECHNUNG | typeof TYP_CODE_KORREKTUR;

/**
 * Lieferdatum im Rechnungskopf (BT-72, „Actual delivery date").
 *   'letzter_leistungstag' — BT-72 = letzter Leistungstag der Rechnung
 *       (entschieden nach Phase 1c): das späteste Leistungsdatum aller
 *       Positionen; hat keine Position ein Leistungsdatum (nur manuelle
 *       Positionen), das Ende des Leistungszeitraums der Rechnung (BG-14).
 *       Damit ist das Pflicht-Element ApplicableHeaderTradeDelivery nie leer
 *       (Factur-X-Schematron PEPPOL-EN16931-R008).
 *   'nie' — nur Leistungszeitraum (BG-14) und Leistungsdatum je Position (BG-26).
 * Die Leistungsdaten je Position bleiben in beiden Fällen unverändert.
 */
export const LIEFERDATUM_IM_KOPF = 'letzter_leistungstag' as 'nie' | 'letzter_leistungstag';

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
  /** Leistungsdatum der Position (BG-26, Start = Ende); null = keins. */
  leistungsdatum?: string | null;
}

export interface ERechnungSteuerGruppe {
  kategorie: string;
  satz: number;
  netto: number;
  ust: number;
}

export interface ERechnungDaten {
  /** UNTDID 1001: 380 Rechnung, 381 Storno/Teilgutschrift. */
  typ: ERechnungTypCode;
  /** Bezug auf die Originalrechnung (BT-25/BT-26) — Pflicht bei 381. */
  bezug?: { nummer: string; datum: string | null } | null;
  /** Freitext der Zahlungsbedingungen (BT-20); ohne: „Zahlungsziel: N Tage". */
  zahlungsText?: string | null;
  nummer: string;
  /** YYYY-MM-DD */
  datum: string;
  faelligAm: string | null;
  zahlungszielTage: number | null;
  leistungVon: string | null;
  leistungBis: string | null;
  /** Lieferdatum im Kopf (BT-72); null/undefined = nicht angeben. */
  lieferdatum?: string | null;
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
