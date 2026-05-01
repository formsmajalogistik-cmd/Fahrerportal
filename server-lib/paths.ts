// Helpers zum Bauen der OneDrive-Ordnerstruktur.
//
//   Maja-Logistik/Formulare/<JJJJ-MM>/<JJJJ-MM-TT>_<Kennzeichen>_<Templatename>/

const ROOT = 'Maja-Logistik/Formulare';

export function sanitizeSegment(s: string): string {
  return (s || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim() || 'unbenannt';
}

export function buildFormularFolder(args: {
  date: string;            // ISO-Datum (Erzeugung des Formulars), Format YYYY-MM-DD
  kennzeichen?: string | null;
  templateName: string;
  formularId: string;
}): string {
  const safeDate = args.date.slice(0, 10);
  const month = safeDate.slice(0, 7);
  const kz = sanitizeSegment(args.kennzeichen || args.formularId.slice(0, 8));
  const tname = sanitizeSegment(args.templateName);
  return `${ROOT}/${month}/${safeDate}_${kz}_${tname}`;
}

export function pathForPdf(folder: string, filename: string): string {
  return `${folder}/${sanitizeSegment(filename.replace(/\.pdf$/i, ''))}.pdf`;
}

export function pathForPhoto(folder: string, filename: string): string {
  return `${folder}/Fotos/${sanitizeSegment(filename)}`;
}
