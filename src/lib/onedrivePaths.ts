// Frontend-Pendant zu /server-lib/paths.ts. Wird beim Foto-Upload und der
// PDF-Generierung verwendet, um konsistente OneDrive-Pfade zu bauen.
//
// Benutzereingaben (Kennzeichen, Kundenname, Templatename …) landen in
// Ordner- und Dateinamen. Früher ließ die Bereinigung Punkte durch: aus
// dem Kennzeichen „WÜ-IT...E" wurde der Ordner „…_WÜ-IT...E_…". Der
// Upload-Endpunkt lehnt jeden Pfad mit „.." ab (Schutz gegen Path-
// Traversal) → 400 „Ungültiger Pfad", jedes Foto dauerhaft. Jetzt gehen
// ALLE Segmente durch sicheresPfadSegment(). Die Formulardaten bleiben
// unverändert — nur der Pfad wird bereinigt.

const ROOT = 'Maja-Logistik/Formulare';

/** Reservierte Namen unter Windows/OneDrive/SharePoint. */
const RESERVIERT = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|\.lock)$/i;

/**
 * Macht aus beliebigem Text ein gültiges OneDrive-Pfadsegment.
 *
 *   * unzulässige Zeichen  " * : < > ? / \ |  sowie # % und Steuerzeichen → _
 *   * Leerzeichen → _ (wie bisher — bestehende Ordnernamen bleiben gleich)
 *   * mehrere Punkte → einer (kein „..", also kein Konflikt mit der
 *     Path-Traversal-Prüfung)
 *   * kein Punkt, Unterstrich oder Leerzeichen am Anfang/Ende, kein „~"
 *     am Anfang; reservierte Namen und „_vti_" werden entschärft
 *   * Umlaute bleiben (NFC); die URL-Kodierung macht der Server pro Segment
 *
 * Für „normale" Werte (z.B. „HH-AB 1234" → „HH-AB_1234") ist das Ergebnis
 * identisch mit der früheren Bereinigung — Ordner laufender Formulare
 * ändern sich dadurch nicht.
 */
export function sicheresPfadSegment(wert: string | null | undefined, ersatz = 'unbenannt'): string {
  let s = String(wert ?? '').normalize('NFC');
  s = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, '_')
    .replace(/["*:<>?/\\|#%]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_vti_/gi, 'vti')
    .replace(/_+/g, '_')
    .replace(/^[._~\s]+|[._\s]+$/g, '');
  if (RESERVIERT.test(s)) s = `_${s}`;
  // Pfadlänge im Rahmen halten (OneDrive: 400 Zeichen gesamt).
  if (s.length > 120) s = s.slice(0, 120).replace(/[._\s]+$/g, '');
  return s || ersatz;
}

/**
 * Dateiname mit Endung: Name und Endung getrennt bereinigen
 * („scan..final .PDF" → „scan.final.pdf").
 */
export function sichererDateiname(name: string | null | undefined, ersatz = 'datei'): string {
  const roh = String(name ?? '').trim();
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(roh);
  const basis = sicheresPfadSegment(m?.[1] ?? roh, ersatz);
  const endung = (m?.[2] ?? '').toLowerCase();
  return `${basis}${endung}`;
}

/** Alter Name — bestehende Aufrufer (Preislisten, Pfade) laufen über die neue Regel. */
export const sanitizeSegment = (s: string): string => sicheresPfadSegment(s);

/**
 * Bereinigt einen schon zusammengesetzten relativen Pfad Segment für
 * Segment — für Einträge, die noch einen alten (unbereinigten) Pfad
 * gespeichert haben.
 */
export function sichererPfad(pfad: string): string {
  return pfad.split('/').filter((x) => x.length > 0).map((seg) => sicheresPfadSegment(seg)).join('/');
}

/** Kennzeichen aus Formulardaten (Feld „kennzeichen" bzw. „Kennzeichen"). */
export function kennzeichenAusDaten(daten: Record<string, unknown> | null | undefined): string | null {
  const v = daten?.['kennzeichen'] ?? daten?.['Kennzeichen'];
  return typeof v === 'string' ? v : null;
}

export function buildFormularFolder(args: {
  date: string;            // YYYY-MM-DD
  kennzeichen?: string | null;
  templateName: string;
  formularId: string;
}): string {
  const safeDate = sicheresPfadSegment(args.date.slice(0, 10), 'ohne-Datum');
  const month = safeDate.slice(0, 7);
  // Leeres oder nur aus Sonderzeichen bestehendes Kennzeichen → Formular-ID.
  const kz = sicheresPfadSegment(args.kennzeichen, '') || sicheresPfadSegment(args.formularId.slice(0, 8));
  const tname = sicheresPfadSegment(args.templateName);
  return `${ROOT}/${month}/${safeDate}_${kz}_${tname}`;
}

export function pathForPdf(folder: string, filename: string): string {
  return `${folder}/${sicheresPfadSegment(filename.replace(/\.pdf$/i, ''))}.pdf`;
}

export function pathForPhoto(folder: string, filename: string): string {
  return `${folder}/Fotos/${sicheresPfadSegment(filename)}`;
}

/**
 * Hinweis fürs Kennzeichenfeld — blockiert nie (provisorische und
 * ausländische Kennzeichen müssen möglich bleiben). true = „Bitte
 * Kennzeichen prüfen".
 */
export function kennzeichenAuffaellig(wert: unknown): boolean {
  if (typeof wert !== 'string') return false;
  const v = wert;
  if (!v.trim()) return false;
  if (v !== v.trim()) return true;                       // Leerzeichen am Anfang/Ende
  if (/\.{2,}/.test(v)) return true;                      // mehrere Punkte
  if (/[.-]$/.test(v) || /^[.-]/.test(v)) return true;  // Punkt/Strich am Rand
  if (/["*:<>?/\\|#%]/.test(v)) return true;              // Zeichen, die in Pfaden nicht gehen
  if (v.replace(/\s/g, '').length > 15) return true;      // ungewöhnlich lang
  return false;
}
