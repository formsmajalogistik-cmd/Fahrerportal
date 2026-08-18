// PDF-Seiten als Bilder rendern.
//
// Ursprünglich im Belege-Reiter (BelegeUploadTab) — jetzt geteilt, weil
// auch das nachträgliche Ergänzen von Belegen zu einem Eingang jede
// PDF-Seite als eigenen Beleg übernimmt.

import { pdfjsLib } from './pdfjs';

/** Render-Auflösung. 150 dpi ist der Kompromiss aus Lesbarkeit und Größe. */
export const PDF_RENDER_DPI = 150;

/**
 * Rendert jede Seite einer PDF als JPEG-Datei. Nutzt das global
 * konfigurierte pdfjs-dist (siehe src/lib/pdfjs.ts).
 *
 * `onProgress` wird VOR dem Rendern jeder Seite aufgerufen, damit der
 * Aufrufer „Seite x von y" anzeigen kann — bei vielen Seiten dauert das
 * spürbar.
 */
export async function pdfToJpegPages(
  file: File,
  onProgress?: (current: number, total: number) => void,
): Promise<File[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  const out: File[] = [];
  const baseName = file.name.replace(/\.pdf$/i, '') || 'pdf';
  const scale = PDF_RENDER_DPI / 72;
  for (let i = 1; i <= total; i += 1) {
    onProgress?.(i, total);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      page.cleanup();
      throw new Error('Canvas-Kontext nicht verfügbar');
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    page.cleanup();
    if (!blob) throw new Error(`Seite ${i} konnte nicht gerendert werden`);
    out.push(new File([blob], `${baseName} - Seite ${i}.jpg`, { type: 'image/jpeg' }));
  }
  return out;
}

/**
 * Brennt ein Kennzeichen als Overlay in ein Bild.
 *
 * Bewusst FEST ins Bild statt als separate Zeichenanweisung: die
 * ergänzten Belege laufen später durch dieselbe dynamic_photos-Logik
 * wie die Fahrer-Belege, und die zeichnet ausschließlich das Bild. Ein
 * getrenntes Overlay würde dort schlicht verschwinden.
 *
 * Optik wie im Belege-PDF: schwarzer Text auf halbtransparentem weißem
 * Kasten, oben links.
 */
export async function brenneKennzeichenEin(
  datei: File,
  kennzeichen: string,
): Promise<File> {
  const text = kennzeichen.trim();
  if (!text) return datei;
  const bitmap = await createImageBitmap(datei);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return datei;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const fontSize = Math.max(14, Math.round(canvas.width * 0.045));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  const padX = Math.round(fontSize * 0.45);
  const padY = Math.round(fontSize * 0.3);
  const breite = ctx.measureText(text).width + 2 * padX;
  const hoehe = fontSize + 2 * padY;
  const x = Math.round(canvas.width * 0.03);
  const y = Math.round(canvas.height * 0.03);

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(x, y, breite, hoehe);
  ctx.fillStyle = '#000000';
  ctx.fillText(text, x + padX, y + padY);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  if (!blob) return datei;
  return new File([blob], datei.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
  });
}
