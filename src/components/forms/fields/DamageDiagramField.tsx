import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
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
        <div className="space-y-2">
          {/* Vorschau (statisch, klickbar zum Öffnen des Overlays) */}
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
                className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold text-white shadow ring-2 ring-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}
                style={{ left: `${m.x}%`, top: `${m.y}%` }}
              >
                {m.kind ?? '?'}
              </span>
            ))}
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-maja-navy/90 px-3 py-1 text-xs font-semibold text-white">
              {markers.length === 0 ? 'Schäden markieren' : `${markers.length} Markierung(en) — bearbeiten`}
            </span>
          </button>

          {/* Beschreibungsliste */}
          {markers.length > 0 && (
            <ul className="space-y-1 text-sm text-maja-ink">
              {markers.map((m, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}>
                    {m.kind ?? '?'}
                  </span>
                  <span className="text-maja-muted">
                    {m.kind ? DAMAGE_KIND_LABEL[m.kind] : 'Markierung'}
                  </span>
                  {m.note && <span>— {m.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
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

function DamageDiagramOverlay({ title, imgUrl, initial, onCancel, onConfirm }: OverlayProps) {
  const [markers, setMarkers] = useState<DamageMarker[]>(initial);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  function pointToPercent(clientX: number, clientY: number): { x: number; y: number } | null {
    const box = boxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x, y };
  }

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (pending) return;
    const p = pointToPercent(e.clientX, e.clientY);
    if (!p) return;
    setPending(p);
  }

  function handleTouch(e: TouchEvent<HTMLDivElement>) {
    if (pending) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const p = pointToPercent(t.clientX, t.clientY);
    if (!p) return;
    setPending(p);
  }

  function placeKind(kind: DamageKind) {
    if (!pending) return;
    setMarkers((m) => [...m, { ...pending, kind }]);
    setPending(null);
  }

  function removeMarker(idx: number) {
    setMarkers((m) => m.filter((_, i) => i !== idx));
  }

  function setNote(idx: number, note: string) {
    setMarkers((m) => m.map((mk, i) => (i === idx ? { ...mk, note } : mk)));
  }

  return (
    <FullscreenOverlay
      title={title}
      hint="Tippe auf das Bild, um einen Schaden zu markieren — wähle dann die Schadensart aus."
      onCancel={onCancel}
      onConfirm={() => onConfirm(markers)}
    >
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
        <div
          ref={boxRef}
          onClick={handleClick}
          onTouchEnd={handleTouch}
          className="relative w-full select-none overflow-hidden rounded-lg border border-maja-navy/20 bg-white"
        >
          <img src={imgUrl} alt={title} className="block w-full" style={{ pointerEvents: 'none' }} />
          {markers.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); removeMarker(i); }}
              className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold text-white shadow ring-2 ring-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}
              style={{ left: `${m.x}%`, top: `${m.y}%` }}
              aria-label={`Markierung ${i + 1} entfernen`}
            >
              {m.kind ?? '?'}
            </button>
          ))}
          {pending && (
            <span
              className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-maja-navy bg-white/40"
              style={{ left: `${pending.x}%`, top: `${pending.y}%` }}
            />
          )}
        </div>

        {/* Beschreibungsliste */}
        {markers.length > 0 && (
          <div className="rounded-lg border border-maja-navy/10 bg-white p-3">
            <h3 className="mb-2 text-sm font-semibold text-maja-navy">Beschreibungen</h3>
            <ul className="space-y-2">
              {markers.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${m.kind ? KIND_BG[m.kind] : 'bg-maja-navy'}`}>
                    {m.kind ?? '?'}
                  </span>
                  <span className="w-24 shrink-0 text-xs text-maja-muted">
                    {m.kind ? DAMAGE_KIND_LABEL[m.kind] : '—'}
                  </span>
                  <input
                    className="input flex-1 py-1.5"
                    placeholder="Beschreibung (z.B. Fahrertür)"
                    value={m.note ?? ''}
                    onChange={(e) => setNote(i, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeMarker(i)}
                    aria-label="Markierung löschen"
                    className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Kind-Picker als zusätzliches Inline-Modal */}
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
