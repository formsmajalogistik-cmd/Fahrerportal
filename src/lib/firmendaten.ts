// Firmendaten des Rechnungsausstellers (Maja-Logistik) — EINE Quelle
// für das Rechnungs-PDF (rechnungPdf.ts) und die E-Rechnung
// (src/lib/erechnung/).
//
// Bisher standen diese Werte fest in rechnungPdf.ts. Sie stehen
// weiterhin fest im Code; die Verschiebung in die Admin-Einstellungen
// ist eine offene Entscheidung (E3) und kommt erst danach.
//
// WICHTIG: Die PDF-Texte unten (`pdf`) bilden die bisherigen Zeilen
// zeichengenau nach. Wer hier etwas ändert, ändert jedes künftige PDF.

export interface Firmendaten {
  /** Name des Verkäufers (EN 16931 BT-27). */
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  /** ISO 3166-1 alpha-2 (BT-40). */
  landCode: string;
  telefon: string;
  email: string;
  /** USt-IdNr. (BT-31). */
  ustId: string;
  /** Steuernummer (BT-32) — nicht hinterlegt (Frage S11). */
  steuernummer: string | null;
  /** Kontaktname (BT-41, Pflicht bei XRechnung) — nicht hinterlegt. */
  kontaktName: string | null;
  iban: string;
  bic: string;
  /** Texte, die das PDF bisher genau so druckt. */
  pdf: {
    /** Erste Zeile der Fußzeile. */
    fussName: string;
    /** Adresszeile der Fußzeile. */
    fussAdresse: string;
  };
}

export const FIRMENDATEN: Readonly<Firmendaten> = Object.freeze({
  name: 'Maja-Logistik M.Janßen',
  strasse: 'Heiligenroder Strasse 38e',
  plz: '28816',
  ort: 'Stuhr-Heiligenrode',
  landCode: 'DE',
  telefon: '+49 17641461645',
  email: 'info@maja-logistik.de',
  ustId: 'DE309356726',
  steuernummer: null,
  kontaktName: null,
  iban: 'DE04280501000001429760',
  bic: 'SLZODE22XXX',
  pdf: Object.freeze({
    fussName: 'Maja-Logistik',
    fussAdresse: 'Heiligenroder Strasse 38e 28816 Stuhr',
  }),
});

/** „28816 Stuhr-Heiligenrode" — wie im Briefkopf des PDFs. */
export function firmaPlzOrt(f: Pick<Firmendaten, 'plz' | 'ort'> = FIRMENDATEN): string {
  return `${f.plz} ${f.ort}`;
}
