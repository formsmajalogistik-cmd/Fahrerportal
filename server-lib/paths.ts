// Helpers zum Bauen der OneDrive-Ordnerstruktur.
//
//   Maja-Logistik/Formulare/<JJJJ-MM>/<JJJJ-MM-TT>_<Kennzeichen>_<Templatename>/
//
// Die Bereinigung ist identisch mit src/lib/onedrivePaths.ts (Frontend) —
// beide Seiten müssen für dieselbe Eingabe denselben Pfad bilden.

const ROOT = 'Maja-Logistik/Formulare';

const RESERVIERT = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|\.lock)$/i;

/** Siehe src/lib/onedrivePaths.ts — gleiche Regeln. */
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
  if (s.length > 120) s = s.slice(0, 120).replace(/[._\s]+$/g, '');
  return s || ersatz;
}

export const sanitizeSegment = (s: string): string => sicheresPfadSegment(s);

/**
 * Path-Traversal-Schutz für relative OneDrive-Pfade. Geprüft wird pro
 * SEGMENT: „..", „." und leere Segmente (z.B. „a//b"), führender „/",
 * Backslash und Steuerzeichen sind unzulässig.
 *
 * Früher: `path.includes('..')`. Das sperrte auch harmlose Namen wie
 * „WÜ-IT...E" — ein Kennzeichen mit mehreren Punkten machte jeden Foto-
 * Upload dauerhaft unmöglich. Für einen Traversal braucht es aber ein
 * Segment, das GENAU „.." ist; das fängt diese Prüfung weiterhin ab.
 */
export function istUnsichererPfad(path: string | null | undefined): boolean {
  if (!path) return true;
  if (path.startsWith('/') || path.includes('\\')) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return true;
  const segmente = path.replace(/\/+$/, '').split('/');
  return segmente.some((s) => s === '' || s === '.' || s === '..' || s.trim() === '..');
}

/**
 * Content-Disposition mit Umlauten: ASCII-Ersatz in filename="…" plus
 * die echte Bezeichnung als filename*=UTF-8''… (RFC 6266/5987). Node
 * lehnt Header mit Zeichen außerhalb Latin-1 sonst mit einer Exception ab.
 */
export function contentDisposition(art: 'inline' | 'attachment', dateiname: string): string {
  const name = (dateiname || 'download').replace(/[\r\n"]/g, '');
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_') || 'download';
  const kodiert = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${art}; filename="${ascii}"; filename*=UTF-8''${kodiert}`;
}

export function buildFormularFolder(args: {
  date: string;            // ISO-Datum (Erzeugung des Formulars), Format YYYY-MM-DD
  kennzeichen?: string | null;
  templateName: string;
  formularId: string;
}): string {
  const safeDate = sicheresPfadSegment(args.date.slice(0, 10), 'ohne-Datum');
  const month = safeDate.slice(0, 7);
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
