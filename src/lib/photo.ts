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

export async function getPhotoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('formular-fotos')
    .createSignedUrl(storagePath, 60 * 60);
  if (error) { console.warn('Signed URL fehlgeschlagen', error); return null; }
  return data?.signedUrl ?? null;
}
