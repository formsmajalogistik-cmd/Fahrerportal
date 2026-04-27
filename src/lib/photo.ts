import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

// Client-seitige Komprimierung: max. 1200px Kante, JPEG ~80%
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 1200,
  useWebWorker: true,
  fileType: 'image/jpeg',
  initialQuality: 0.8,
} as const;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([compressed], name, { type: compressed.type });
  } catch (err) {
    console.warn('Bildkompression fehlgeschlagen, sende Original', err);
    return file;
  }
}

export async function uploadPhoto(
  file: File,
  userId: string,
  formularId: string,
  fieldId: string,
): Promise<string> {
  const compressed = await compressImage(file);
  const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
  const path = `${userId}/${formularId}/${fieldId}.${ext}`;
  const { error } = await supabase.storage
    .from('formular-fotos')
    .upload(path, compressed, { contentType: compressed.type, upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Triggert einen Browser-Download der angegebenen Datei. Wird genutzt, wenn
 * der User in den Profil-Einstellungen die Option „Auch in Galerie speichern"
 * aktiviert hat.
 */
export function downloadFile(file: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    console.warn('[downloadFile] fehlgeschlagen', err);
  }
}

export async function getPhotoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('formular-fotos')
    .createSignedUrl(storagePath, 60 * 60);
  if (error) { console.warn('Signed URL fehlgeschlagen', error); return null; }
  return data?.signedUrl ?? null;
}

/**
 * Löscht alle Fotos eines ausgefüllten Formulars im Bucket formular-fotos.
 * Pfad-Konvention: <user_id>/<formular_id>/<feld>.jpg
 */
export async function deleteFormularPhotos(
  userId: string,
  formularId: string,
): Promise<void> {
  const prefix = `${userId}/${formularId}`;
  const { data: list, error } = await supabase.storage
    .from('formular-fotos')
    .list(prefix);
  if (error) { console.warn('Foto-Liste fehlgeschlagen', error); return; }
  if (!list || list.length === 0) return;
  const paths = list.map((f) => `${prefix}/${f.name}`);
  const { error: rmErr } = await supabase.storage
    .from('formular-fotos')
    .remove(paths);
  if (rmErr) console.warn('Foto-Löschen fehlgeschlagen', rmErr);
}
