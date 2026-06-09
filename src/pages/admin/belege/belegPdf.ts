import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type Layout = 12 | 16;

export interface KennzeichenOverlayOptions {
  text: string;
  /** Position in Prozent (0..100), relativ zum gezeichneten Bild — top/left. */
  position: { x: number; y: number };
}

interface PdfOptions {
  /** Bilder als Blobs (JPEG/PNG). Reihenfolge = Reihenfolge im PDF. */
  images: Blob[];
  /** 12 = 3×4-Raster, 16 = 4×4-Raster. */
  layout: Layout;
  /** Optionaler Kennzeichen-Text-Overlay pro Beleg-Bild (Aufgabe 2). */
  kennzeichen?: KennzeichenOverlayOptions | null;
}

// A4 Hochformat in pt (pdf-lib default unit).
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 28.35; // 10 mm

const LAYOUTS: Record<Layout, { cols: number; rows: number }> = {
  12: { cols: 3, rows: 4 },
  16: { cols: 4, rows: 4 },
};

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Erzeugt ein A4-PDF (Hochformat), das die übergebenen Bilder
 * in einem 3×4- (12) oder 4×4- (16) Raster anzeigt. Jedes Bild
 * wird aspect-fit in seine Zelle eingepasst, dünne hellgraue
 * Trennlinien zwischen den Zellen.
 */
export async function generateBelegePdf({ images, layout, kennzeichen }: PdfOptions): Promise<Blob> {
  const { cols, rows } = LAYOUTS[layout];
  const perPage = cols * rows;
  const usableW = A4_W - 2 * MARGIN;
  const usableH = A4_H - 2 * MARGIN;
  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const innerPad = 2; // pt — kleiner Abstand zwischen Bild und Zellenrand
  const grid = rgb(0.85, 0.85, 0.85);
  const overlayText = (kennzeichen?.text ?? '').trim();
  const overlayPos = kennzeichen?.position ?? { x: 4, y: 3 };

  const doc = await PDFDocument.create();
  const helvetica = overlayText ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const totalPages = Math.max(1, Math.ceil(images.length / perPage));

  for (let p = 0; p < totalPages; p++) {
    const page = doc.addPage([A4_W, A4_H]);

    // Raster-Linien zeichnen — über die volle Seite, auch in leeren Zellen.
    for (let c = 0; c <= cols; c++) {
      const x = MARGIN + c * cellW;
      page.drawLine({
        start: { x, y: MARGIN },
        end:   { x, y: MARGIN + usableH },
        thickness: 0.5,
        color: grid,
      });
    }
    for (let r = 0; r <= rows; r++) {
      const y = MARGIN + r * cellH;
      page.drawLine({
        start: { x: MARGIN, y },
        end:   { x: MARGIN + usableW, y },
        thickness: 0.5,
        color: grid,
      });
    }

    // Bilder einbetten und zentriert in ihre Zelle einpassen.
    const slice = images.slice(p * perPage, (p + 1) * perPage);
    for (let i = 0; i < slice.length; i++) {
      const blob = slice[i];
      const bytes = await blobToBytes(blob);
      let embedded;
      // pdf-lib unterscheidet zwischen JPG und PNG — versuche JPG zuerst.
      try {
        embedded = await doc.embedJpg(bytes);
      } catch {
        embedded = await doc.embedPng(bytes);
      }
      const imgW = embedded.width;
      const imgH = embedded.height;

      const slot = i;
      const slotRow = Math.floor(slot / cols);          // 0 oben in unserer Lese-Reihenfolge
      const slotCol = slot % cols;
      const cellLeft = MARGIN + slotCol * cellW;
      // PDF y wächst nach oben — wir zeichnen aus Lese-Reihenfolge oben.
      const cellBottom = MARGIN + usableH - (slotRow + 1) * cellH;

      const innerW = cellW - 2 * innerPad;
      const innerH = cellH - 2 * innerPad;
      const scale = Math.min(innerW / imgW, innerH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const x = cellLeft + (cellW - drawW) / 2;
      const y = cellBottom + (cellH - drawH) / 2;

      page.drawImage(embedded, { x, y, width: drawW, height: drawH });

      // Kennzeichen-Overlay pro Bild — Position in Prozent relativ zum
      // gezeichneten Bild (oben-links-Ursprung), Text in schwarz auf
      // halbtransparentem weißem Kasten.
      if (overlayText && helvetica) {
        const fontSize = Math.max(7, Math.min(16, drawW * 0.07));
        const padX = fontSize * 0.45;
        const padY = fontSize * 0.25;
        const textWidth = helvetica.widthOfTextAtSize(overlayText, fontSize);
        const textHeight = helvetica.heightAtSize(fontSize);
        const offsetX = (Math.max(0, Math.min(100, overlayPos.x)) / 100) * drawW;
        const offsetY = (Math.max(0, Math.min(100, overlayPos.y)) / 100) * drawH;
        // PDF-Koordinaten wachsen nach oben — Bild-Top entspricht y + drawH.
        const imageTop = y + drawH;
        const boxLeft = x + offsetX;
        const boxTop = imageTop - offsetY;
        const boxW = textWidth + 2 * padX;
        const boxH = textHeight + 2 * padY;
        // Halbtransparenter weißer Hintergrund (opacity 0.75) für
        // Lesbarkeit auf dunklen Belegen.
        page.drawRectangle({
          x: boxLeft,
          y: boxTop - boxH,
          width: boxW,
          height: boxH,
          color: rgb(1, 1, 1),
          opacity: 0.75,
          borderWidth: 0,
        });
        page.drawText(overlayText, {
          x: boxLeft + padX,
          y: boxTop - boxH + padY,
          size: fontSize,
          font: helvetica,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  const out = await doc.save();
  return new Blob([out as unknown as ArrayBuffer], { type: 'application/pdf' });
}

/** Schickt einen Blob als Download an den Browser. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
