/**
 * Konvertiert eine HEIC/HEIF-Datei zu JPEG. Wird nur dynamisch geladen,
 * damit der heic2any-Wasm-Decoder nicht ins Initial-Bundle wandert.
 */
export async function heicToJpeg(file: File): Promise<File> {
  const isHeic = /\.(heic|heif)$/i.test(file.name)
    || file.type === 'image/heic'
    || file.type === 'image/heif';
  if (!isHeic) return file;
  const mod = await import('heic2any');
  const heic2any = mod.default;
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }) as Blob;
  const name = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([blob], name, { type: 'image/jpeg' });
}
