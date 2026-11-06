// Gemeinsame Texte und Konstanten für PDF-Lesekopie und XML — damit
// beide Dateien wörtlich dasselbe sagen.

/** Hinweis im Summenblock des normalen PDFs (unverändert). */
export const LEISTUNGSDATUM_HINWEIS = 'Leistungsdatum = Datum des Fahrauftrages';
/** In Lesekopie und XML: das Leistungsdatum steht je Position. */
export const LEISTUNGSDATUM_HINWEIS_LESEKOPIE = 'Leistungsdatum = Tag des Tourabschlusses (je Position angegeben)';
export const LESEKOPIE_HINWEIS = 'PDF-Lesekopie. Maßgeblich ist die E-Rechnung (XML nach EN 16931).';

/** Mailtext-Hinweis beim Versand einer E-Rechnung (in der Vorlage editierbar). */
export const MAIL_HINWEIS_ERECHNUNG =
  'Die maßgebliche Rechnung ist die angehängte XML-Datei (E-Rechnung nach EN 16931). Die PDF-Datei dient nur der Ansicht.';

/** Dokumenttitel der Korrekturbelege. */
export const STORNO_TITEL = 'Stornorechnung';
