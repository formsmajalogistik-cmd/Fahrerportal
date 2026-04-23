import { useRef, type MouseEvent } from 'react';
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
        Klicke auf die Skizze, um Schäden zu markieren. Erneut klicken, um einen Marker zu entfernen.
      </p>
      <div
        ref={boxRef}
        onClick={handleClick}
        className="relative aspect-[2/1] w-full overflow-hidden rounded-lg border border-maja-navy/20 bg-white"
      >
        <VehicleOutline />
        {markers.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); removeMarker(i); }}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/90 text-xs font-semibold text-white ring-2 ring-white"
            style={{ left: `${m.x}%`, top: `${m.y}%`, width: 24, height: 24 }}
            aria-label={`Marker ${i + 1} entfernen`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-maja-muted">{markers.length} Markierung(en)</p>
    </div>
  );
}

function VehicleOutline() {
  return (
    <svg viewBox="0 0 400 200" className="h-full w-full" preserveAspectRatio="none">
      <g fill="none" stroke="#1B3A5C" strokeWidth="2">
        <path d="M40 140 L60 90 L140 70 L280 70 L340 95 L360 140 L40 140 Z" />
        <circle cx="110" cy="145" r="18" />
        <circle cx="300" cy="145" r="18" />
        <path d="M150 70 L170 100 L230 100 L250 70" />
        <path d="M170 100 L190 85 L210 85 L230 100" />
      </g>
    </svg>
  );
}
