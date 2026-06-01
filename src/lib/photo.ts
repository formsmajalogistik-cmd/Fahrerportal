import imageCompression from 'browser-image-compression';
import { uploadToOneDrive, getOneDriveObjectUrl } from './onedrive';
import { heicToJpeg } from './heic';

// Client-seitige Komprimierung: max. 1200px Kante, JPEG ~80%
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 1200,
  useWebWorker: true,
  fileType: 'image/jpeg',
  initialQuality: 0.8,
} as const;

// Für sehr große Originale (typische iPhone-Aufnahmen 4000×3000, 3–5 MB)
// aggressiver: kleinere Kante + niedrigere Qualität, damit Upload und
// spätere PDF-Einbettung auf dem Gerät nicht an Speicher/Zeit scheitern.
const AGGRESSIVE_OPTIONS = {
  maxSizeMB: 1.0,
  maxWidthOrHeight: 1000,
  useWebWorker: true,
  fileType: 'image/jpeg',
  initialQuality: 0.6,
} as const;

const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

export async function compressImage(file: File): Promise<File> {
  // 1. HEIC/HEIF zuerst zu JPEG konvertieren — iPhone-Standardformat, das
  //    sonst in Vorschau und PDF-Einbettung Probleme macht.
  let working = file;
  try {
    working = await heicToJpeg(file);
  } catch (err) {
    console.warn('[compressImage] HEIC-Konvertierung fehlgeschlagen', err);
  }

  if (!working.type.startsWith('image/') && !/\.(jpe?g|png)$/i.test(working.name)) {
    return working;
  }

  const options = working.size > LARGE_FILE_THRESHOLD ? AGGRESSIVE_OPTIONS : COMPRESSION_OPTIONS;
  try {
    const compressed = await imageCompression(working, options);
    const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
    const name = working.name.replace(/\.[^.]+$/, '') + '.' + ext;
    console.info(
      `[compressImage] ${file.name}: ${file.size} → ${compressed.size} B`
      + (working.size > LARGE_FILE_THRESHOLD ? ' (aggressiv)' : ''),
    );
    return new File([compressed], name, { type: compressed.type });
  } catch (err) {
    console.warn('[compressImage] Bildkompression fehlgeschlagen, sende (ggf. konvertiertes) Original', err);
    return working;
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

function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  // iOS-Safari + iPadOS-Safari (gibt sich seit iPadOS 13 als Mac aus)
  return /iP(hone|ad|od)/.test(ua)
    || (/Macintosh/.test(ua) && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
}

/**
 * Speichert eine Datei lokal — auf iOS bevorzugt über die Web Share API
 * (`navigator.share`), die das Bild direkt zum Speichern in der Foto-
 * Mediathek anbietet. Auf Desktop/Android wird ein klassischer
 * `<a download>`-Trigger verwendet. `<a download>` wird auf iOS-Safari
 * weitgehend ignoriert und öffnet das Bild stattdessen in einem neuen
 * Tab — daher der Share-Fallback dort.
 */
export async function downloadFile(file: Blob, filename: string): Promise<boolean> {
  // 1. iOS: Web Share API mit File → System-Dialog "In Fotos sichern".
  if (isIosLike() && typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      const shareFile = file instanceof File
        ? file
        : new File([file], filename, { type: file.type || 'image/jpeg' });
      const data: ShareData = { files: [shareFile], title: filename };
      // canShare ist nur in Chromium implementiert — auf iOS verlassen wir uns
      // auf den Try-Catch.
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.canShare === 'function' && !nav.canShare(data)) {
        // Fallback wenn der Browser explizit sagt: nicht teilbar.
        throw new Error('canShare=false');
      }
      await navigator.share(data);
      return true;
    } catch (err) {
      // AbortError = User hat den Dialog abgebrochen — nicht weiter probieren.
      if (err instanceof Error && err.name === 'AbortError') return false;
      console.warn('[downloadFile] Web Share fehlgeschlagen, falle auf Download zurück', err);
      // Auf iOS reicht der Download-Fallback nicht — wir öffnen das Bild
      // stattdessen in einem neuen Tab, damit der User es per Long-Press
      // speichern kann.
      try {
        const url = URL.createObjectURL(file);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return true;
      } catch (e) {
        console.warn('[downloadFile] Tab-Öffnen fehlgeschlagen', e);
        return false;
      }
    }
  }

  // 2. Desktop / Android: klassischer Download über <a download>.
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch (err) {
    console.warn('[downloadFile] Download fehlgeschlagen', err);
    return false;
  }
}

/**
 * Liefert eine Object-URL für ein OneDrive-Foto. Aufrufer ist verantwortlich
 * fürs URL.revokeObjectURL.
 *
 * `formularId` MUSS für Fahrer mitgegeben werden: der Download-Proxy
 * (/api/download) verlangt seit der Pro-Resource-Auth eine formular_id und
 * antwortet sonst für Nicht-Admins mit 403 — die Foto-Vorschau bliebe
 * andernfalls leer, sobald die lokale Blob-URL nach Seitenwechsel weg ist.
 */
export async function getPhotoUrl(
  storagePath: string, formularId?: string | null,
): Promise<string | null> {
  return await getOneDriveObjectUrl(storagePath, { formularId });
}
