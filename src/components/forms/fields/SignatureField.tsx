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
        className="block w-full overflow-hidden rounded-lg border border-maja-navy/20 bg-white text-left transition hover:bg-maja-light/40 disabled:opacity-50"
      >
        {dataUrl ? (
          <img src={dataUrl} alt={field.label} className="block max-h-32 w-full object-contain p-2" />
        ) : (
          <div className="flex h-24 items-center justify-center text-sm font-medium text-maja-accent">
            ✍ Unterschrift erfassen
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

function SignatureOverlay({ title, initial, onCancel, onConfirm }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasContent, setHasContent] = useState<boolean>(!!initial);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 600;
    const h = rect.height || 240;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = STROKE;
    if (initial) {
      const img = new Image();
      img.onload = () => {
        try { ctx.drawImage(img, 0, 0, w, h); }
        catch (err) { console.warn('[SignatureOverlay] Bild laden fehlgeschlagen', err); }
      };
      img.src = initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getPoint(e: RPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
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
    setHasContent(true);
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      title={title}
      hint="Mit dem Finger oder Stift unterschreiben."
      onCancel={onCancel}
      onConfirm={handleConfirm}
      confirmDisabled={!hasContent}
    >
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
        <div className="flex-1 overflow-hidden rounded-lg border border-maja-navy/20 bg-white">
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
            className="block h-full w-full touch-none"
          />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={clear} className="text-sm font-medium text-maja-accent hover:underline">
            Zurücksetzen
          </button>
        </div>
      </div>
    </FullscreenOverlay>
  );
}
