// Ein Zusatzbild (dynamic_photos) speichern — direkt oder über die
// Upload-Warteschlange.
//
// Vorher lud das Zusatzbilder-Feld nur direkt hoch. Schlug das fehl
// (Funkloch), war das Foto weg; übrig blieb eine Fehlermeldung am Feld,
// das womöglich auf einer anderen Formularseite lag. Jetzt gilt dasselbe
// wie bei Einzelfotos: online direkt versuchen (mit den harten Timeouts
// aus uploadPhotoToOneDrive), sonst in die IDB-Warteschlange. Der
// Sync-Drainer lädt nach und ersetzt den Platzhalter (lib/pendingFoto).
//
// Genutzt vom Zusatzbilder-Feld UND vom Foto-Dialog nach dem Setzen
// eines Schadenpunkts — damit beide denselben Weg gehen.

import { compressImage, uploadPhotoToOneDrive } from './photo';
import { enqueueUpload, type UploadQueueItem } from './offlineDb';
import { diagnose } from './diagnose';
import type { PhotoValue } from '../types/db';

const DIREKT_TIMEOUT_MS = 20_000;

function zufall(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 8);
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2, 10);
}

export interface ZusatzbildErgebnis {
  wert: PhotoValue;
  /** true = liegt in der Warteschlange, Sync anstoßen. */
  inWarteschlange: boolean;
}

/**
 * Komprimiert, lädt hoch oder reiht ein. Wirft nur, wenn das Bild weder
 * hochgeladen noch lokal gesichert werden konnte.
 *
 * `quelle` steht nur im Diagnose-Protokoll (Feld vs. Schaden-Dialog).
 */
export async function zusatzbildSpeichern(
  file: File,
  opts: { feldId: string; oneDriveFolder: string; formularId?: string; quelle: string },
): Promise<ZusatzbildErgebnis> {
  const { feldId, oneDriveFolder, formularId, quelle } = opts;
  let komprimiert: File;
  try { komprimiert = await compressImage(file); } catch { komprimiert = file; }
  const ext = komprimiert.type === 'image/jpeg' ? 'jpg' : 'png';
  // Eindeutig ohne laufende Nummer — die wäre bei parallelen Aufnahmen
  // nicht stabil. Zeitstempel + Zufall reichen gegen Kollisionen.
  const dateiname = `${feldId}_${Date.now()}_${zufall()}.${ext}`;

  if (navigator.onLine) {
    try {
      // Gesamtzeit für den Direkt-Versuch begrenzen. Die einzelnen Aufrufe
      // haben eigene Timeouts — aber vor dem Upload wartet die Anmeldung
      // u.U. auf eine Token-Erneuerung, die supabase-js bei schlechtem Netz
      // minutenlang mit Backoff wiederholt. Im Test hing ein Foto so über
      // 45 s. Danach lieber in die Warteschlange: dort ist es sicher.
      // (Läuft der Direkt-Upload im Hintergrund doch noch durch, liegt die
      // Datei doppelt in OneDrive — harmlos, das Formular verweist auf die
      // aus der Warteschlange.)
      const pfad = await Promise.race([
        uploadPhotoToOneDrive(komprimiert, oneDriveFolder, dateiname),
        new Promise<never>((_, reject) => window.setTimeout(
          () => reject(new Error(`Direkt-Upload nach ${DIREKT_TIMEOUT_MS / 1000} s abgebrochen`)),
          DIREKT_TIMEOUT_MS)),
      ]);
      diagnose('foto_upload_ok', { feld: feldId, quelle, kb: Math.round(komprimiert.size / 1024) });
      return {
        wert: { storage_path: pfad, mime_type: komprimiert.type, size_bytes: komprimiert.size },
        inWarteschlange: false,
      };
    } catch (err) {
      diagnose('foto_upload_fehler', {
        feld: feldId, quelle, fehler: err instanceof Error ? err.message : String(err),
        weiter: 'warteschlange',
      });
    }
  }

  if (!formularId) {
    diagnose('foto_verworfen', { feld: feldId, quelle, grund: 'keine_formular_id' });
    throw new Error('Foto konnte nicht hochgeladen werden (keine Formular-ID für die Warteschlange).');
  }
  const id = `${formularId}:${feldId}:${Date.now().toString(36)}-${zufall()}`;
  const item: UploadQueueItem = {
    id, formularId, fieldId: feldId,
    folder: oneDriveFolder, filename: dateiname, blob: komprimiert,
    attempts: 0, nextRetryAt: 0, lastError: null,
  };
  try {
    await enqueueUpload(item);
  } catch (err) {
    diagnose('foto_verworfen', {
      feld: feldId, quelle, grund: 'warteschlange_fehler',
      fehler: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Foto konnte weder hochgeladen noch lokal gesichert werden.');
  }
  diagnose('foto_in_warteschlange', { feld: feldId, quelle, online: navigator.onLine });
  return {
    wert: { pending_id: id, mime_type: komprimiert.type, size_bytes: komprimiert.size },
    inWarteschlange: true,
  };
}
