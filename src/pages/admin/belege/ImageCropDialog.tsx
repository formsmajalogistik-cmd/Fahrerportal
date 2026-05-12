import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';

interface Props {
  /** Bild als ObjectURL oder Data-URL. */
  imageUrl: string;
  onCancel: () => void;
  onApply: (cropped: Blob) => void;
}

/**
 * Modal-Dialog mit react-easy-crop:
 * - Verschieben (Drag / Touch)
 * - Pinch- oder Slider-Zoom
 * - 90°-Rotation Buttons
 * - "Übernehmen" liefert das zugeschnittene Bild als JPEG-Blob.
 */
export function ImageCropDialog({ imageUrl, onCancel, onApply }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset, wenn ein neues Bild geöffnet wird.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
  }, [imageUrl]);

  const onCropComplete = useCallback((_area: Area, areaPx: Area) => {
    setCroppedAreaPixels(areaPx);
  }, []);

  async function handleApply() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await cropImageToJpeg(imageUrl, croppedAreaPixels, rotation);
      onApply(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex flex-col bg-black/90">
      <div className="relative flex-1 overflow-hidden">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          // Festes Hochformat-Verhältnis — der Crop-Rahmen kann nicht
          // resized werden, das Bild wird mit Pan + Zoom innerhalb des
          // Rahmens positioniert. Bild-Bereiche außerhalb werden beim
          // Export weiß (PDF-Zelle ist weiß hinterlegt).
          aspect={3 / 4}
          // Zoom-Bereich deutlich erweitert: bis 0.3 herunter, damit auch
          // ein quer fotografierter Beleg komplett in den Crop-Bereich
          // passt (mit weißen Rändern).
          minZoom={0.3}
          maxZoom={3}
          // Mit "contain" startet das Bild komplett sichtbar in der
          // Vorschau; "cover" hätte initial schon zugeschnitten.
          objectFit="contain"
          // Bild darf über die Crop-Grenzen hinaus geschoben werden —
          // notwendig, wenn das Bild kleiner als der Rahmen ist (Zoom<1).
          restrictPosition={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
          showGrid={true}
        />
      </div>
      <div className="space-y-3 bg-white p-4">
        <div className="flex items-center gap-3">
          <label htmlFor="zoom" className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Zoom
          </label>
          <input
            id="zoom"
            type="range"
            min={0.3}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm"
              onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
            >
              ⟲ 90° links
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              ⟳ 90° rechts
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" onClick={handleApply} disabled={busy || !croppedAreaPixels}>
              {busy ? 'Wird angewandt …' : 'Übernehmen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Crop-Implementierung -------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

async function cropImageToJpeg(url: string, area: Area, rotation: number): Promise<Blob> {
  const img = await loadImage(url);
  const rad = (rotation * Math.PI) / 180;

  // Wir zeichnen das Bild rotiert in ein Off-Screen-Canvas mit Größe gleich
  // der rotierten Bounding-Box, schneiden dann den von react-easy-crop
  // gelieferten Pixel-Bereich heraus.
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const rotW = img.width * cos + img.height * sin;
  const rotH = img.width * sin + img.height * cos;

  const stage = document.createElement('canvas');
  stage.width = rotW;
  stage.height = rotH;
  const sctx = stage.getContext('2d');
  if (!sctx) throw new Error('Canvas-Kontext nicht verfügbar');
  sctx.translate(rotW / 2, rotH / 2);
  sctx.rotate(rad);
  sctx.drawImage(img, -img.width / 2, -img.height / 2);

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(area.width));
  out.height = Math.max(1, Math.round(area.height));
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas-Kontext nicht verfügbar');
  // Hintergrund weiß füllen — bei Zoom < 1 oder verschobenem Bild kann
  // der Crop-Bereich über das tatsächliche Bild hinaus reichen; die
  // freien Stellen sollen weiß bleiben (passt zur weißen PDF-Zelle).
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, out.width, out.height);

  // Quell-Rechteck auf das verfügbare rotierte Bild beschneiden, damit
  // drawImage nicht mit Out-of-Bounds-Koordinaten arbeitet (Browser
  // werfen sonst Fehler bzw. liefern undefiniertes Verhalten).
  const sx = Math.max(0, area.x);
  const sy = Math.max(0, area.y);
  const ex = Math.min(stage.width, area.x + area.width);
  const ey = Math.min(stage.height, area.y + area.height);
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw > 0 && sh > 0) {
    const scaleX = out.width / area.width;
    const scaleY = out.height / area.height;
    const dx = (sx - area.x) * scaleX;
    const dy = (sy - area.y) * scaleY;
    const dw = sw * scaleX;
    const dh = sh * scaleY;
    octx.drawImage(stage, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild-Export fehlgeschlagen'))),
      'image/jpeg',
      0.9,
    );
  });
}
