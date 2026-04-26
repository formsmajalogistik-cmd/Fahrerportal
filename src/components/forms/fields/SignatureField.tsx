import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

const HEIGHT = 160;
const STROKE = '#0F2439';

/**
 * Canvas-basierte Unterschrift ohne externe Abhängigkeit. Die externe
 * Bibliothek `react-signature-canvas` führte unter React 19 zu Render-Errors
 * (Element type is invalid / #130) — diese eigene Implementierung umgeht das.
 */
export function SignatureField({ field, value, onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const cssSize = useRef<{ w: number; h: number }>({ w: 0, h: HEIGHT });

  // Canvas einmalig auf die DPR skalieren und ggf. existierende DataURL laden.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || HEIGHT;
    cssSize.current = { w, h };
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = STROKE;
    if (typeof value === 'string' && value.startsWith('data:image')) {
      const img = new Image();
      img.onload = () => {
        try { ctx.drawImage(img, 0, 0, w, h); }
        catch (err) { console.warn('[SignatureField] Bild laden fehlgeschlagen', err); }
      };
      img.src = value;
    }
    // value/disabled bewusst nicht in deps: wir laden nur einmal beim Mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getPoint(e: RPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    const p = getPoint(e);
    if (!p) return;
    drawing.current = true;
    last.current = p;
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch {/* ignore */}
  }

  function onMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
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
    try {
      const url = canvasRef.current?.toDataURL('image/png') ?? null;
      onChange(url);
    } catch (err) {
      console.warn('[SignatureField] toDataURL fehlgeschlagen', err);
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div className="overflow-hidden rounded-lg border border-maja-navy/20 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
          className="block w-full touch-none"
          style={{ height: HEIGHT }}
        />
      </div>
      {!disabled && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={clear} className="text-sm font-medium text-maja-accent hover:underline">
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
