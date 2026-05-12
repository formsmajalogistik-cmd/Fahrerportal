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
          aspect={undefined}
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
            min={1}
            max={4}
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
  out.width = Math.round(area.width);
  out.height = Math.round(area.height);
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas-Kontext nicht verfügbar');
  octx.drawImage(stage, area.x, area.y, area.width, area.height, 0, 0, out.width, out.height);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild-Export fehlgeschlagen'))),
      'image/jpeg',
      0.9,
    );
  });
}
