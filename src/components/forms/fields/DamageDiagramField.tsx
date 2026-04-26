import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { getDamageDiagramSignedUrl } from '../../../lib/damageDiagramStorage';
import type { DamageMarker, FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (markers: DamageMarker[]) => void;
  disabled?: boolean;
}

function asMarkers(v: unknown): DamageMarker[] {
  return Array.isArray(v) ? (v as DamageMarker[]) : [];
}

export function DamageDiagramField({ field, value, onChange, disabled }: Props) {
  const markers = asMarkers(value);
  const boxRef = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);

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

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onChange([...markers, { x, y }]);
  }

  function removeMarker(idx: number) {
    if (disabled) return;
    onChange(markers.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <p className="mb-2 text-xs text-maja-muted">
        Tippe auf das Bild, um Schäden zu markieren — jede Markierung erhält eine
        eigene Nummer. Tippe auf eine Markierung, um sie zu entfernen.
      </p>

      {!field.vehicleImage && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Für dieses Feld ist im Template noch kein Fahrzeugbild hinterlegt.
          Der Admin kann es im Template-Editor hochladen.
        </div>
      )}
      {imgError && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {imgError}
        </div>
      )}

      {field.vehicleImage && (
        <div
          ref={boxRef}
          onClick={handleClick}
          className="relative w-full overflow-hidden rounded-lg border border-maja-navy/20 bg-maja-light"
          style={{ minHeight: 180 }}
        >
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={field.label}
              className="block w-full select-none"
              style={{ pointerEvents: 'none' }}
            />
          ) : (
            <div className="flex aspect-[2/1] w-full items-center justify-center text-xs text-maja-muted">
              Bild wird geladen …
            </div>
          )}
          {markers.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); removeMarker(i); }}
              className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600/95 text-xs font-bold text-white shadow ring-2 ring-white"
              style={{ left: `${m.x}%`, top: `${m.y}%` }}
              aria-label={`Markierung ${i + 1} entfernen`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-maja-muted">{markers.length} Markierung(en)</p>
    </div>
  );
}
