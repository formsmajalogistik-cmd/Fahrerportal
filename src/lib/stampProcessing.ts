// Stempel-Freistellung: Papier-Hintergrund per Helligkeits-Threshold
// transparent machen, Bounding Box croppen, als PNG zurückgeben. Läuft
// rein im Browser (Canvas-2D). Bei zweifelhaftem Ergebnis kehrt der
// Helper auf das Original zurück, statt einen kaputt freigestellten
// Stempel zu liefern.

export interface StampProcessResult {
  /** Verarbeitetes (oder Original-)Bild. */
  blob: Blob;
  /** true = Freistellung war plausibel, false = Original wird benutzt. */
  processed: boolean;
}

function loadImageBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  // Sehr alter Safari-Pfad — sollte heute nie nötig sein.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = (err) => { reject(err); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob lieferte null'));
    }, 'image/png');
  });
}

/** Auto-Freistellung des Papierhintergrunds eines Stempel-Fotos.
 *  Konservativ: liefert das Original zurück, wenn die Heuristik
 *  zu wenig oder zu viel Pixel als Stempel klassifiziert. */
export async function processStampImage(imageBlob: Blob): Promise<StampProcessResult> {
  try {
    const img = await loadImageBitmap(imageBlob);
    const w = (img as { width?: number }).width ?? 0;
    const h = (img as { height?: number }).height ?? 0;
    if (!w || !h) return { blob: imageBlob, processed: false };

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: imageBlob, processed: false };
    ctx.drawImage(img as CanvasImageSource, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // 1) Adaptiver Helligkeits-Threshold — Papier ist relativ zur
    // Bild-Helligkeit hell, der Stempel relativ dunkel.
    let totalLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalLuma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const avgLuma = totalLuma / (data.length / 4);
    const threshold = Math.min(avgLuma * 0.85, 200);

    let coloredPixels = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (luma > threshold) {
          // Papier → transparent.
          data[i + 3] = 0;
        } else {
          coloredPixels += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          // Sättigung leicht anheben.
          data[i + 3] = Math.min(255, data[i + 3] * 1.2);
        }
      }
    }

    const totalPixels = w * h;
    const coloredRatio = coloredPixels / totalPixels;
    if (coloredRatio < 0.005 || coloredRatio > 0.6) {
      console.warn('[Stempel] Freistellung unsicher, nutze Original', { coloredRatio });
      return { blob: imageBlob, processed: false };
    }

    ctx.putImageData(imageData, 0, 0);

    // 2) Auto-Crop auf die Bounding Box mit 5 % Rand.
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;
    const cropX = Math.max(0, Math.floor(minX - padX));
    const cropY = Math.max(0, Math.floor(minY - padY));
    const cropW = Math.min(w - cropX, Math.ceil(maxX - minX + 2 * padX));
    const cropH = Math.min(h - cropY, Math.ceil(maxY - minY + 2 * padY));
    if (cropW <= 0 || cropH <= 0) {
      return { blob: imageBlob, processed: false };
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return { blob: imageBlob, processed: false };
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const blob = await canvasToPng(cropCanvas);
    return { blob, processed: true };
  } catch (err) {
    console.warn('[Stempel] Verarbeitung fehlgeschlagen', err);
    return { blob: imageBlob, processed: false };
  }
}
