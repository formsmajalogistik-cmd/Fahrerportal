import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { FullscreenOverlay } from '../FullscreenOverlay';
import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

const STROKE = '#0F2439';

export function SignatureField({ field, value, onChange, disabled }: Props) {
  const dataUrl = typeof value === 'string' && value.startsWith('data:image') ? value : null;
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <button
        type="button"
        onClick={() => setOverlayOpen(true)}
        disabled={disabled}
        className="block w-full overflow-hidden rounded-lg border border-maja-navy/20 !bg-white text-left transition hover:bg-maja-light/40 disabled:opacity-50 dark:border-slate-400"
      >
        {dataUrl ? (
          <img src={dataUrl} alt={field.label} className="block max-h-32 w-full object-contain p-2" />
        ) : (
          <div className="flex h-24 items-center justify-center text-sm font-medium text-maja-accent">
            Unterschrift erfassen
          </div>
        )}
      </button>
      {dataUrl && !disabled && (
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="text-sm font-medium text-red-600 hover:underline"
                  onClick={() => onChange(null)}>
            Zurücksetzen
          </button>
        </div>
      )}

      {overlayOpen && !disabled && (
        <SignatureOverlay
          title={field.label}
          initial={dataUrl}
          onCancel={() => setOverlayOpen(false)}
          onConfirm={(url) => { onChange(url); setOverlayOpen(false); }}
        />
      )}
    </div>
  );
}

interface OverlayProps {
  title: string;
  initial: string | null;
  onCancel: () => void;
  onConfirm: (url: string | null) => void;
}

/**
 * Unterschrifts-Overlay. Bewusst kein Drehen — Hochformat, volle Breite.
 * Touch-Tracking: getBoundingClientRect() des Canvas + DPR-Skalierung
 * direkt im 2D-Kontext (`ctx.scale(dpr, dpr)`), sodass die Pointer-
 * Koordinaten 1:1 in CSS-Pixeln mit dem gezeichneten Bild übereinstimmen.
 */
export function SignatureOverlay({ title, initial, onCancel, onConfirm }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasContent, setHasContent] = useState<boolean>(!!initial);

  // Canvas an Container-Größe anpassen + auf DPR skalieren. Wird auch
  // bei Resize (Tastatur ein/aus, Rotation, etc.) erneut ausgeführt.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function setup() {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      // Bestehendes Bild sichern, neu aufsetzen, alten Inhalt zurückzeichnen.
      let snapshot: HTMLImageElement | null = null;
      try {
        const url = c.toDataURL('image/png');
        if (url && hasContent) {
          const img = new Image();
          img.src = url;
          snapshot = img;
        }
      } catch { /* canvas evtl. leer */ }
      c.width = Math.max(1, Math.floor(w * dpr));
      c.height = Math.max(1, Math.floor(h * dpr));
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = STROKE;
      // Initial / Snapshot zurückzeichnen
      const drawSrc = (src: string) => {
        const img = new Image();
        img.onload = () => { try { ctx.drawImage(img, 0, 0, w, h); } catch { /* ignore */ } };
        img.src = src;
      };
      if (snapshot) {
        // Aus dem Backup nochmal laden (Image kann durch das toDataURL bereits dekodiert sein)
        drawSrc(snapshot.src);
      } else if (initial) {
        drawSrc(initial);
      }
    }

    setup();
    const onResize = () => setup();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getPoint(e: RPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // Bounding-Rect liefert die CSS-Pixel-Position des Canvas relativ
    // zum Viewport — Pointer-Coords sind in clientX/Y, also einfach
    // subtrahieren.
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: RPointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const p = getPoint(e);
    if (!p) return;
    drawing.current = true;
    last.current = p;
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch {/* ignore */}
    // Sofort einen Punkt zeichnen, damit Tap-without-Move auch sichtbar ist.
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = STROKE;
      ctx.fill();
    }
    setHasContent(true);
  }

  function onMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const p = getPoint(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!p || !ctx || !last.current) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function onUp(e: RPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch {/* ignore */}
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // ClearRect respektiert die Transform-Matrix nicht für die Devicegröße,
    // also über die Pixel-Größe putzen.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasContent(false);
  }

  function handleConfirm() {
    if (!hasContent) { onConfirm(null); return; }
    try {
      const url = canvasRef.current?.toDataURL('image/png') ?? null;
      onConfirm(url);
    } catch (err) {
      console.warn('[SignatureOverlay] toDataURL fehlgeschlagen', err);
      onConfirm(null);
    }
  }

  return (
    <FullscreenOverlay
      title={`Unterschrift — ${title}`}
      hint="Mit dem Finger oder Stift unterschreiben."
      onCancel={onCancel}
      onConfirm={handleConfirm}
      confirmDisabled={!hasContent}
      destructiveAction={hasContent ? { label: 'Löschen', onClick: clear } : undefined}
    >
      <div className="h-full w-full p-3">
        {/* Canvas-Container: IMMER weißer Hintergrund — auch im Dark
            Mode. Sonst geht der schwarze Strich auf der getönten
            Surface unter. Inline-Style + !-Modifier setzen das gegen
            den Bulk-Override in index.css durch. */}
        <div
          className="h-full w-full overflow-hidden rounded-lg border border-maja-navy/20 !bg-white dark:border-slate-400"
          style={{ backgroundColor: '#FFFFFF' }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
            className="block h-full w-full"
            style={{ touchAction: 'none' }}
          />
        </div>
      </div>
    </FullscreenOverlay>
  );
}
