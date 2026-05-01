import imageCompression from 'browser-image-compression';
import { uploadToOneDrive, getOneDriveObjectUrl } from './onedrive';

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

/**
 * Lädt ein Foto nach OneDrive hoch und gibt den OneDrive-Pfad zurück, der
 * im daten-JSON unter `storage_path` gespeichert wird.
 */
export async function uploadPhotoToOneDrive(
  file: File,
  folder: string,
  filename: string,
): Promise<string> {
  const compressed = await compressImage(file);
  // Pfad: <folder>/Fotos/<filename>
  const path = `${folder.replace(/\/+$/, '')}/Fotos/${filename}`;
  await uploadToOneDrive(path, compressed);
  return path;
}

/**
 * Triggert einen Browser-Download der angegebenen Datei (lokal). Wird genutzt,
 * wenn der User in den Profil-Einstellungen die Option „Auch in Galerie
 * speichern" aktiviert hat.
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

/**
 * Liefert eine Object-URL für ein OneDrive-Foto. Aufrufer ist verantwortlich
 * fürs URL.revokeObjectURL.
 */
export async function getPhotoUrl(storagePath: string): Promise<string | null> {
  return await getOneDriveObjectUrl(storagePath);
}
