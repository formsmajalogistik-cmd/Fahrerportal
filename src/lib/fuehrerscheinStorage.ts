import { supabase } from './supabase';
import { compressImage } from './photo';

// Privater Bucket für Führerschein-Bilder. NICHT öffentlich, RLS-
// geschützt (siehe Migration 061). Bilder werden NIE in OneDrive oder
// als base64 in der DB abgelegt — ausschließlich hier, und nach der
// Admin-Prüfung unwiderruflich gelöscht.
const BUCKET = 'fuehrerschein';

export type FuehrerscheinSeite = 'vorderseite' | 'rueckseite';

/** Storage-Pfad: {abfrage_id}/{fahrer_id}/{seite}.jpg
 *  Der fahrer_id-Teil ([2]) wird von der Storage-RLS gegen den
 *  eingeloggten Nutzer geprüft. */
function buildPath(abfrageId: string, fahrerId: string, seite: FuehrerscheinSeite): string {
  return `${abfrageId}/${fahrerId}/${seite}.jpg`;
}

/**
 * Komprimiert das Bild (wie andere Foto-Uploads) und lädt es in den
 * privaten Bucket. Gibt den Storage-Pfad zurück (wird in
 * fuehrerschein_einreichungen gespeichert).
 */
export async function uploadFuehrerscheinBild(
  file: File,
  abfrageId: string,
  fahrerId: string,
  seite: FuehrerscheinSeite,
): Promise<string> {
  const compressed = await compressImage(file);
  const path = buildPath(abfrageId, fahrerId, seite);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, {
      contentType: compressed.type || 'image/jpeg',
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/** Kurzlebige signierte URL (Default 5 Minuten) für die Admin-Sichtung. */
export async function getFuehrerscheinSignedUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) {
    console.warn('[Fuehrerschein] Signed URL fehlgeschlagen', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Löscht die Bilder unwiderruflich aus dem Bucket. Wird beim Abhaken
 * durch den Admin aufgerufen. Leere/Null-Pfade werden ignoriert.
 */
export async function deleteFuehrerscheinBilder(paths: Array<string | null | undefined>): Promise<void> {
  const valid = paths.filter((p): p is string => !!p && p.trim() !== '');
  if (valid.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(valid);
  if (error) throw error;
}
