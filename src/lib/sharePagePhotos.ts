import { getUploadQueue } from './offlineDb';
import { downloadFromOneDrive } from './onedrive';
import type { FormSection, PhotoValue } from '../types/db';

// ============================================================
// „Fotos dieser Seite sichern" — Web Share API.
//
// Sammelt alle bereits aufgenommenen Bilder der Felder einer Formular-
// Seite und teilt sie über das native Teilen-Menü (iOS/Android →
// „In Fotos sichern"). Hintergrund: Eine Web-App kann NICHT automatisch
// in die Geräte-Galerie schreiben — die bewusste Teilen-Aktion ist der
// einzige zuverlässige Weg.
// ============================================================

function asPhoto(v: unknown): PhotoValue | null {
  if (v && typeof v === 'object' && ('storage_path' in v || 'pending_id' in v)) {
    return v as PhotoValue;
  }
  return null;
}

/** Alle Bild-Werte (photo / stamp / dynamic_photos) der Seite einsammeln. */
function collectPhotoValues(
  sections: FormSection[],
  data: Record<string, unknown>,
): PhotoValue[] {
  const out: PhotoValue[] = [];
  for (const s of sections) {
    for (const f of s.fields ?? []) {
      if (!f?.id || !f.type) continue;
      const v = data[f.id];
      if (f.type === 'photo' || f.type === 'stamp') {
        const p = asPhoto(v);
        if (p) out.push(p);
      } else if (f.type === 'dynamic_photos' && Array.isArray(v)) {
        for (const x of v) {
          const p = asPhoto(x);
          if (p) out.push(p);
        }
      }
    }
  }
  return out;
}

/** Anzahl tatsächlich erfasster Bilder auf der Seite (für die Sichtbarkeit
 *  des Buttons). */
export function countPageImages(
  sections: FormSection[],
  data: Record<string, unknown>,
): number {
  return collectPhotoValues(sections, data).length;
}

async function photoToBlob(p: PhotoValue, formularId: string): Promise<Blob | null> {
  // Noch nicht hochgeladen → Blob liegt in der IDB-Upload-Queue.
  if (p.pending_id) {
    try {
      const items = await getUploadQueue();
      return items.find((i) => i.id === p.pending_id)?.blob ?? null;
    } catch { return null; }
  }
  // Bereits hochgeladen → aus OneDrive laden (RLS-geschützter Proxy).
  if (p.storage_path) {
    try {
      return await downloadFromOneDrive(p.storage_path, { formularId });
    } catch { return null; }
  }
  return null;
}

/** Lädt die Blobs aller erfassten Bilder der Seite (leere Felder ignoriert). */
export async function collectPageImageBlobs(
  sections: FormSection[],
  data: Record<string, unknown>,
  formularId: string,
): Promise<Blob[]> {
  const values = collectPhotoValues(sections, data);
  const blobs: Blob[] = [];
  for (const p of values) {
    const b = await photoToBlob(p, formularId);
    if (b) blobs.push(b);
  }
  return blobs;
}

export type ShareResult = 'shared' | 'downloaded' | 'none';

/**
 * Teilt die Blobs über die Web Share API. Fällt zurück auf Einzel-
 * Download, wenn das native Teilen nicht verfügbar ist.
 */
export async function sharePhotos(blobs: Blob[]): Promise<ShareResult> {
  if (blobs.length === 0) return 'none';
  const files = blobs.map((b, i) => new File([b], `foto_${i + 1}.jpg`, {
    type: b.type || 'image/jpeg',
  }));
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: 'Formular-Fotos' });
      return 'shared';
    } catch (err) {
      // Abbruch durch den Nutzer ist kein Fehler.
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
      console.warn('[sharePhotos] Teilen fehlgeschlagen, falle auf Download zurück', err);
    }
  }
  // Fallback: einzeln herunterladen.
  for (let i = 0; i < blobs.length; i += 1) {
    const url = URL.createObjectURL(blobs[i]);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foto_${i + 1}.jpg`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return 'downloaded';
}
