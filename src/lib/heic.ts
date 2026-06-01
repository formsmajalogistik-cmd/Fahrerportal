/**
 * Konvertiert eine HEIC/HEIF-Datei zu JPEG. Wird nur dynamisch geladen,
 * damit der heic2any-Wasm-Decoder nicht ins Initial-Bundle wandert.
 *
 * iPhones liefern Fotos häufig als HEIC. Nicht-Safari-Browser können HEIC
 * weder anzeigen noch ins PDF einbetten — deshalb konvertieren wir früh,
 * direkt beim Upload, statt das Risiko in die spätere Vorschau/PDF-Pipeline
 * zu tragen. Schlägt die Konvertierung fehl, geben wir das Original zurück
 * (der Aufrufer hat eigene Fallbacks).
 */
export async function heicToJpeg(file: File): Promise<File> {
  const isHeic = /\.(heic|heif)$/i.test(file.name)
    || file.type === 'image/heic'
    || file.type === 'image/heif';
  if (!isHeic) return file;
  try {
    const mod = await import('heic2any');
    const heic2any = mod.default;
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }) as Blob;
    const name = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([blob], name, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[heicToJpeg] Konvertierung fehlgeschlagen, nutze Original', err);
    return file;
  }
}
