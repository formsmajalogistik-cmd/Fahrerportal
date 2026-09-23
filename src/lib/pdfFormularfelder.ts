// Interaktive Formularfelder (AcroForm) aus PDF-Vorlagen entfernen.
//
// Viele Kundenvorlagen (z.B. Arval: 48 Textfelder + 13 Kontrollkästchen)
// sind im Original ausfüllbare PDFs. Die App füllt diese Felder NICHT —
// sie zeichnet die Werte als Text und Kreuze direkt auf die Seite. Die
// Felder bleiben dadurch leer, und PDF-Betrachter heben leere Felder
// standardmäßig blau hervor. Ergebnis: blaue Kästen über bzw. unter den
// gezeichneten Einträgen.
//
// Entfernt wird ausschließlich die interaktive Ebene:
//   * Annotationen vom Typ /Widget (die sichtbare Seite eines Feldes),
//   * der /AcroForm-Eintrag im Katalog (die Feldliste).
// Andere Annotationen — Links, Kommentare — bleiben stehen. Der
// Seiteninhalt selbst wird nicht angefasst.
//
// Bewusst KEIN pdf-lib `form.flatten()`: das würde die (leeren)
// Feld-Erscheinungsbilder in den Seiteninhalt einbrennen, inklusive
// eventueller Hintergrundfarben. Und NIE `pdf.getForm()` aufrufen — das
// legt eine AcroForm an, wenn keine existiert.
//
// Nebeneffekt, gewollt: die fertige PDF ist im Betrachter nicht mehr
// editierbar — passend für ein abgeschlossenes Protokoll.

import { PDFArray, PDFDict, PDFName, type PDFDocument, type PDFObject } from 'pdf-lib';

const ANNOTS = PDFName.of('Annots');
const SUBTYPE = PDFName.of('Subtype');
const WIDGET = PDFName.of('Widget');
const ACROFORM = PDFName.of('AcroForm');

export interface FormularfelderBefund {
  /** Anzahl Widget-Annotationen über alle Seiten. */
  widgets: number;
  /** Katalog trägt eine /AcroForm. */
  acroForm: boolean;
}

function istWidget(pdf: PDFDocument, eintrag: PDFObject): boolean {
  const dict = pdf.context.lookup(eintrag);
  return dict instanceof PDFDict && dict.get(SUBTYPE) === WIDGET;
}

/** Nur zählen, nichts ändern — für den Hinweis beim Vorlagen-Upload. */
export function pruefeFormularfelder(pdf: PDFDocument): FormularfelderBefund {
  let widgets = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      if (istWidget(pdf, annots.get(i))) widgets += 1;
    }
  }
  return { widgets, acroForm: pdf.catalog.has(ACROFORM) };
}

/**
 * Entfernt alle Widget-Annotationen und die AcroForm. Arbeitet direkt am
 * übergebenen Dokument; zurück kommt, was entfernt wurde.
 */
export function entferneFormularfelder(pdf: PDFDocument): FormularfelderBefund {
  let widgets = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const behalten: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const eintrag = annots.get(i);
      if (istWidget(pdf, eintrag)) widgets += 1;
      else behalten.push(eintrag);
    }
    if (behalten.length === annots.size()) continue;
    if (behalten.length === 0) {
      page.node.delete(ANNOTS);
    } else {
      const neu = PDFArray.withContext(pdf.context);
      for (const e of behalten) neu.push(e);
      page.node.set(ANNOTS, neu);
    }
  }
  const acroForm = pdf.catalog.has(ACROFORM);
  if (acroForm) pdf.catalog.delete(ACROFORM);
  return { widgets, acroForm };
}
