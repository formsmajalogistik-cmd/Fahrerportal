import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { getDamageDiagramSignedUrl } from '../../../lib/damageDiagramStorage';
import { FullscreenOverlay } from '../FullscreenOverlay';
import type { DamageKind, DamageMarker, FormField } from '../../../types/db';
import { DAMAGE_KIND_LABEL } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (markers: DamageMarker[]) => void;
  disabled?: boolean;
}

function asMarkers(v: unknown): DamageMarker[] {
  return Array.isArray(v) ? (v as DamageMarker[]) : [];
}

const KIND_ORDER: DamageKind[] = ['D', 'K', 'S', 'U'];
const MAX_MARKERS = 20;

const KIND_BG: Record<DamageKind, string> = {
  D: 'bg-amber-500',
  K: 'bg-red-600',
  S: 'bg-purple-600',
  U: 'bg-orange-600',
};

export function DamageDiagramField({ field, value, onChange, disabled }: Props) {
  const markers = asMarkers(value);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgError(null);
    if (!field.vehicleImage) { setImgUrl(null); return; }
    getDamageDiagramSignedUrl(field.vehicleImage).then((u) => {
      if (cancelled) return;
      if (u) setImgUrl(u);
      else setImgError('Schadendiagramm konnte nicht geladen werden.');
    });
    return () => { cancelled = true; };
  }, [field.vehicleImage]);

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>

      {!field.vehicleImage && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Für dieses Feld ist im Template noch kein Fahrzeugbild hinterlegt.
        </div>
      )}
      {imgError && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {imgError}
        </div>
      )}

      {field.vehicleImage && (
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          disabled={disabled}
          className="relative block w-full overflow-hidden rounded-lg border border-maja-navy/20 bg-maja-light text-left disabled:opacity-50"
        >
          {imgUrl ? (
            <img src={imgUrl} alt={field.label} className="block w-full select-none"
                 style={{ pointerEvents: 'none' }} />
          ) : (
            <div className="flex aspect-[2/1] w-full items-center justify-center text-xs text-maja-muted">
              Bild wird geladen …
            </div>
          )}
          {markers.map((m, i) => (
            <span
              key={i}
              className={`absolute flex h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-bold text-white shadow ring-1 ring-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}
              style={{ left: `${m.x}%`, top: `${m.y}%` }}
            >
              {m.kind ?? '?'}
            </span>
          ))}
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-maja-navy/90 px-3 py-1 text-xs font-semibold text-white">
            {markers.length === 0 ? 'Schäden markieren' : `${markers.length} Markierung(en) — bearbeiten`}
          </span>
        </button>
      )}

      {overlayOpen && imgUrl && field.vehicleImage && (
        <DamageDiagramOverlay
          title={field.label}
          imgUrl={imgUrl}
          initial={markers}
          onCancel={() => setOverlayOpen(false)}
          onConfirm={(next) => { onChange(next); setOverlayOpen(false); }}
        />
      )}
    </div>
  );
}

// ---------- Overlay ----------

interface OverlayProps {
  title: string;
  imgUrl: string;
  initial: DamageMarker[];
  onCancel: () => void;
  onConfirm: (next: DamageMarker[]) => void;
}

interface PointerInfo { x: number; y: number }

function distance(a: PointerInfo, b: PointerInfo): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TAP_THRESHOLD_PX = 8;

function DamageDiagramOverlay({ title, imgUrl, initial, onCancel, onConfirm }: OverlayProps) {
  const [markers, setMarkers] = useState<DamageMarker[]>(initial);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [maxedOut, setMaxedOut] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef<Map<number, PointerInfo>>(new Map());
  const downStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const moveDist = useRef(0);
  const lastPinch = useRef<{ dist: number } | null>(null);
  const lastPan = useRef<PointerInfo | null>(null);

  // Bei Mount: Bild laden, scale/tx/ty zurücksetzen.
  useEffect(() => {
    setTransform({ scale: 1, tx: 0, ty: 0 });
  }, []);

  function clampPan(scale: number, tx: number, ty: number): { tx: number; ty: number } {
    const c = containerRef.current;
    if (!c) return { tx, ty };
    const rect = c.getBoundingClientRect();
    const overX = Math.max(0, (rect.width * scale - rect.width) / 2);
    const overY = Math.max(0, (rect.height * scale - rect.height) / 2);
    return {
      tx: Math.max(-overX, Math.min(overX, tx)),
      ty: Math.max(-overY, Math.min(overY, ty)),
    };
  }

  function placeMarker(clientX: number, clientY: number) {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    // getBoundingClientRect berücksichtigt CSS-Transforms (scale + translate)
    // bereits — die % der Bildposition sind also direkt korrekt.
    const px = ((clientX - rect.left) / rect.width) * 100;
    const py = ((clientY - rect.top) / rect.height) * 100;
    if (px < 0 || px > 100 || py < 0 || py > 100) return;
    if (markers.length >= MAX_MARKERS) {
      setMaxedOut(true);
      window.setTimeout(() => setMaxedOut(false), 2000);
      return;
    }
    setSelectedIdx(null);
    setPending({ x: px, y: py });
  }

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      downStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      moveDist.current = 0;
      lastPan.current = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      const arr = Array.from(pointers.current.values());
      lastPinch.current = { dist: distance(arr[0], arr[1]) };
      lastPan.current = null;
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {/* ignore */}
  }

  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && lastPinch.current) {
      const arr = Array.from(pointers.current.values());
      const d = distance(arr[0], arr[1]);
      const ratio = d / lastPinch.current.dist;
      setTransform((t) => {
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * ratio));
        // Beim Pinch-Reset auf Scale 1 → Pan zurücksetzen.
        if (newScale === 1) return { scale: 1, tx: 0, ty: 0 };
        const clamped = clampPan(newScale, t.tx, t.ty);
        return { scale: newScale, ...clamped };
      });
      lastPinch.current = { dist: d };
    } else if (pointers.current.size === 1 && lastPan.current) {
      const dx = e.clientX - lastPan.current.x;
      const dy = e.clientY - lastPan.current.y;
      moveDist.current += Math.hypot(dx, dy);
      if (transform.scale > 1) {
        setTransform((t) => {
          const next = clampPan(t.scale, t.tx + dx, t.ty + dy);
          return { ...t, ...next };
        });
      }
      lastPan.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLDivElement>) {
    const wasSinglePointer = pointers.current.size === 1;
    const start = downStart.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
    if (pointers.current.size === 0) {
      lastPan.current = null;
      // Tap-Erkennung: nur ein Pointer aktiv, wenig Bewegung, kein Pinch.
      if (wasSinglePointer && start && moveDist.current < TAP_THRESHOLD_PX) {
        placeMarker(e.clientX, e.clientY);
      }
      downStart.current = null;
      moveDist.current = 0;
    }
  }

  function placeKind(kind: DamageKind) {
    if (!pending) return;
    setMarkers((m) => [...m, { ...pending, kind }]);
    setPending(null);
  }

  function removeMarker(idx: number) {
    setMarkers((m) => m.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  }

  function resetView() {
    setTransform({ scale: 1, tx: 0, ty: 0 });
  }

  return (
    <FullscreenOverlay
      title={`Schäden — ${title}`}
      hint="Tippen platziert einen Marker. Mit zwei Fingern zoomen, mit einem Finger verschieben."
      onCancel={onCancel}
      onConfirm={() => onConfirm(markers)}
      destructiveAction={markers.length > 0 ? { label: 'Alle löschen', onClick: () => { setMarkers([]); setSelectedIdx(null); } } : undefined}
    >
      <div className="flex h-full w-full flex-col">
        {/* Legende */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-maja-navy/10 bg-white px-3 py-2 text-xs">
          {KIND_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${KIND_BG[k]}`}>
                {k}
              </span>
              <span className="text-maja-ink">{DAMAGE_KIND_LABEL[k]}</span>
            </span>
          ))}
          <span className="ml-auto text-maja-muted">{markers.length} / {MAX_MARKERS}</span>
          {transform.scale > 1 && (
            <button
              type="button"
              onClick={resetView}
              className="ml-2 rounded-md border border-maja-navy/15 bg-white px-2 py-0.5 font-medium text-maja-navy hover:bg-maja-light"
            >
              Zoom zurücksetzen
            </button>
          )}
        </div>

        {/* Bild-Container mit Pinch/Pan */}
        <div className="flex-1 min-h-0 overflow-hidden bg-maja-light/40">
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative flex h-full w-full items-center justify-center select-none"
            style={{ touchAction: 'none' }}
          >
            <div
              className="relative w-full"
              style={{
                transform: `translate3d(${transform.tx}px, ${transform.ty}px, 0) scale(${transform.scale})`,
                transformOrigin: 'center center',
                transition: 'transform 50ms linear',
              }}
            >
              <img
                ref={imgRef}
                src={imgUrl}
                alt={title}
                className="block w-full"
                draggable={false}
                style={{ pointerEvents: 'none' }}
              />
              {markers.map((m, i) => {
                const isSelected = selectedIdx === i;
                return (
                  <div key={i}
                       className="absolute"
                       style={{ left: `${m.x}%`, top: `${m.y}%` }}>
                    <button
                      type="button"
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onPointerUp={(ev) => ev.stopPropagation()}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedIdx(isSelected ? null : i); }}
                      className={`flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ring-1 ring-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}
                      aria-label={`Markierung ${i + 1}`}
                      style={{ touchAction: 'none' }}
                    >
                      {m.kind ?? '?'}
                    </button>
                    {isSelected && (
                      <button
                        type="button"
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => { ev.stopPropagation(); removeMarker(i); }}
                        className="absolute -translate-x-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow ring-2 ring-white"
                        style={{ left: '0.6rem', top: '-1.6rem', touchAction: 'none' }}
                        aria-label="Markierung löschen"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Hinweis "Maximum erreicht" */}
        {maxedOut && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow">
            Maximum erreicht ({MAX_MARKERS} Markierungen)
          </div>
        )}
      </div>

      {/* Schadensart-Picker */}
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-maja-ink/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-maja-navy">Schadensart wählen</h3>
            <div className="grid grid-cols-2 gap-2">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => placeKind(k)}
                  className={`flex flex-col items-center gap-1 rounded-lg p-3 text-white transition hover:opacity-90 ${KIND_BG[k]}`}
                >
                  <span className="text-2xl font-bold">{k}</span>
                  <span className="text-xs">{DAMAGE_KIND_LABEL[k]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="btn-secondary mt-3 w-full"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </FullscreenOverlay>
  );
}
