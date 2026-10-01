import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ladeSchadenbild } from '../../../lib/damageDiagramStorage';
import { diagnose } from '../../../lib/diagnose';
import { istTipp, punktAusTipp } from '../../../lib/skizzeTipp';
import { FullscreenOverlay } from '../FullscreenOverlay';
import { XIcon } from '../../icons';
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
  const [ladeVersuch, setLadeVersuch] = useState(0);
  const pfad = field.vehicleImage ?? null;

  useEffect(() => {
    if (!pfad) return;
    let cancelled = false;
    const t0 = Date.now();
    ladeSchadenbild(pfad).then(({ url, quelle }) => {
      if (cancelled) return;
      setImgUrl(url);
      setImgError(null);
      diagnose('bild_geladen', { feld: field.id, quelle, ms: Date.now() - t0, versuch: ladeVersuch + 1 });
    }).catch((err) => {
      if (cancelled) return;
      const text = err instanceof Error ? err.message : String(err);
      setImgError(text);
      diagnose('bild_fehler', { feld: field.id, fehler: text, versuch: ladeVersuch + 1, online: navigator.onLine });
    });
    return () => { cancelled = true; };
  }, [pfad, ladeVersuch, field.id]);

  // Kommt der Empfang zurück, ohne Zutun neu versuchen.
  useEffect(() => {
    if (!imgError) return;
    const nochmal = () => setLadeVersuch((n) => n + 1);
    window.addEventListener('online', nochmal);
    return () => window.removeEventListener('online', nochmal);
  }, [imgError]);

  const bildFehlt = !imgUrl;

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
        <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="flex-1">
            Fahrzeugbild konnte nicht geladen werden{navigator.onLine ? '' : ' (kein Empfang)'}.
            Schäden lassen sich erst setzen, wenn das Bild da ist.
          </span>
          <button type="button" className="font-semibold underline"
                  onClick={() => setLadeVersuch((n) => n + 1)}>
            Erneut laden
          </button>
        </div>
      )}

      {field.vehicleImage && (
        <button
          type="button"
          onClick={() => {
            if (bildFehlt) {
              // Statt still nichts zu tun: neu laden und protokollieren.
              diagnose('skizze_ohne_bild_angetippt', { feld: field.id, fehler: imgError });
              setLadeVersuch((n) => n + 1);
              return;
            }
            setOverlayOpen(true);
          }}
          disabled={disabled}
          className="relative block w-full overflow-hidden rounded-lg border border-maja-navy/20 bg-maja-light text-left disabled:opacity-50"
        >
          {imgUrl ? (
            <img src={imgUrl} alt={field.label} className="block w-full select-none"
                 style={{ pointerEvents: 'none' }} />
          ) : (
            <div className="flex aspect-[2/1] w-full items-center justify-center text-xs text-maja-muted">
              {imgError ? 'Bild nicht verfügbar — antippen zum erneuten Laden' : 'Bild wird geladen …'}
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
          feldId={field.id}
          title={field.label}
          imgUrl={imgUrl}
          initial={markers}
          onCancel={() => setOverlayOpen(false)}
          onConfirm={(next) => {
            onChange(next);
            setOverlayOpen(false);
            diagnose('punkte_gespeichert', { feld: field.id, anzahl: next.length });
          }}
        />
      )}
    </div>
  );
}

// ---------- Overlay ----------

interface OverlayProps {
  feldId: string;
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

function DamageDiagramOverlay({ feldId, title, imgUrl, initial, onCancel, onConfirm }: OverlayProps) {
  const [markers, setMarkers] = useState<DamageMarker[]>(initial);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [maxedOut, setMaxedOut] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef<Map<number, PointerInfo>>(new Map());
  const downStart = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Größte Entfernung vom Aufsetzpunkt während der Geste. */
  const maxEntfernung = useRef(0);
  const lastPinch = useRef<{ dist: number } | null>(null);
  const lastPan = useRef<PointerInfo | null>(null);
  // Tipps erst annehmen, wenn das Bild geladen UND vermessen ist —
  // vorher hat es die Höhe 0 und jeder Tipp ginge ins Leere.
  const [bildBereit, setBildBereit] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [verwerfenFragen, setVerwerfenFragen] = useState(false);
  // Zeitpunkt, an dem die Schadensart-Auswahl aufging. Nach einem Tipp
  // schickt der Browser noch einen synthetischen Klick an dieselbe
  // Stelle — die Auswahl liegt dann schon darüber. Ohne Sperre wählte
  // dieser Geisterklick ungefragt die Schadensart unter dem Finger oder
  // traf „Abbrechen" (Punkt weg, für den Fahrer passierte „nichts").
  const auswahlOffenSeit = useRef(0);
  const GEISTERKLICK_MS = 400;
  function istGeisterklick(ziel: string): boolean {
    if (Date.now() - auswahlOffenSeit.current >= GEISTERKLICK_MS) return false;
    diagnose('geisterklick_ignoriert', { feld: feldId, ziel });
    return true;
  }

  function zeigeHinweis(text: string) {
    setHinweis(text);
    window.setTimeout(() => setHinweis((h) => (h === text ? null : h)), 2500);
  }

  function bildGeladen() {
    const img = imgRef.current;
    const r = img?.getBoundingClientRect();
    const ok = !!img && img.naturalWidth > 0 && !!r && r.width > 0 && r.height > 0;
    setBildBereit(ok);
    diagnose(ok ? 'skizze_geoeffnet' : 'skizze_bild_ohne_groesse', {
      feld: feldId, breite: r?.width ?? 0, hoehe: r?.height ?? 0,
      punkte: initial.length, pointer: typeof window.PointerEvent === 'function',
    });
  }

  // Drehen / Größenänderung: Zoom zurücksetzen. Die Verschiebe-Grenzen
  // gelten sonst für die alte Größe. Punkte selbst sind Prozentwerte und
  // bleiben an ihrer Stelle.
  useEffect(() => {
    let t: number | null = null;
    function onResize() {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        setTransform({ scale: 1, tx: 0, ty: 0 });
        const r = imgRef.current?.getBoundingClientRect();
        diagnose('skizze_groesse_geaendert', { feld: feldId, breite: r?.width ?? 0, hoehe: r?.height ?? 0 });
      }, 250);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (t) window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [feldId]);

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
    if (!img || !bildBereit) {
      diagnose('tap_verworfen', { feld: feldId, grund: 'bild_nicht_geladen' });
      zeigeHinweis('Bild wird noch geladen …');
      return;
    }
    // getBoundingClientRect im Moment des Tipps — berücksichtigt Zoom,
    // Verschiebung, Drehung und Seitenwechsel ohne gespeicherte Maße.
    const ergebnis = punktAusTipp(clientX, clientY, img.getBoundingClientRect());
    if (!ergebnis.ok) {
      diagnose('tap_verworfen', { feld: feldId, grund: ergebnis.grund });
      return;
    }
    if (markers.length >= MAX_MARKERS) {
      setMaxedOut(true);
      diagnose('tap_verworfen', { feld: feldId, grund: 'maximum' });
      window.setTimeout(() => setMaxedOut(false), 2000);
      return;
    }
    setSelectedIdx(null);
    auswahlOffenSeit.current = Date.now();
    setPending({ x: ergebnis.x, y: ergebnis.y });
  }

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      downStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      maxEntfernung.current = 0;
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
      const start = downStart.current;
      if (start) {
        maxEntfernung.current = Math.max(maxEntfernung.current,
          Math.hypot(e.clientX - start.x, e.clientY - start.y));
      }
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
      // Tipp: ein Finger, kaum vom Aufsetzpunkt entfernt (siehe istTipp).
      if (wasSinglePointer && start) {
        const ende = { x: e.clientX, y: e.clientY };
        if (istTipp(start, ende, maxEntfernung.current)) {
          placeMarker(e.clientX, e.clientY);
        } else if (maxEntfernung.current < 40) {
          // Knapp daneben — interessant, falls Tipps auf einem Gerät
          // systematisch nicht erkannt werden.
          diagnose('tap_verworfen', {
            feld: feldId, grund: 'bewegung',
            abstand: Math.hypot(ende.x - start.x, ende.y - start.y), max: maxEntfernung.current,
          });
        }
      }
      downStart.current = null;
      maxEntfernung.current = 0;
    }
  }

  // Vom Browser abgebrochene Geste: aufräumen, aber KEINEN Punkt setzen.
  // Vorher lief das über onPointerUp und konnte einen Punkt erzeugen.
  function onPointerCancel(e: RPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
    if (pointers.current.size === 0) {
      lastPan.current = null;
      downStart.current = null;
      maxEntfernung.current = 0;
    }
    diagnose('tap_abgebrochen', { feld: feldId });
  }

  const geaendert = JSON.stringify(markers) !== JSON.stringify(initial);

  // „Abbrechen", ESC: bei ungespeicherten Änderungen erst nachfragen.
  const abbrechen = useCallback(() => {
    if (geaendert) { setVerwerfenFragen(true); return; }
    diagnose('skizze_abgebrochen', { feld: feldId, verworfen: 0 });
    onCancel();
  }, [geaendert, feldId, onCancel]);

  function placeKind(kind: DamageKind) {
    if (!pending) return;
    // Funktional — nie mit einem veralteten Stand der Liste rechnen.
    setMarkers((m) => [...m, { ...pending, kind }]);
    diagnose('punkt_gesetzt', { feld: feldId, x: pending.x, y: pending.y, art: kind, anzahl: markers.length + 1 });
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
      onCancel={abbrechen}
      onConfirm={() => {
        // Foto-Aufforderung (Aufgabe 4): wenn neue Marker hinzugekommen
        // sind, signalisiert das Diagramm dem FormRenderer, wie viele
        // — der entscheidet dann, ob er den DynamicPhotos-Prompt zeigt.
        const newCount = Math.max(0, markers.length - initial.length);
        diagnose('skizze_bestaetigt', { feld: feldId, punkte: markers.length, neu: newCount });
        if (newCount > 0) {
          window.dispatchEvent(new CustomEvent('maja:damage-points-added', {
            detail: { count: newCount },
          }));
        }
        onConfirm(markers);
      }}
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
            onPointerCancel={onPointerCancel}
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
                onLoad={bildGeladen}
                onError={() => {
                  setBildBereit(false);
                  diagnose('skizze_bild_fehler', { feld: feldId });
                  zeigeHinweis('Fahrzeugbild konnte nicht angezeigt werden.');
                }}
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
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {hinweis && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-1.5 text-xs font-semibold text-white shadow">
            {hinweis}
          </div>
        )}

        {/* Hinweis "Maximum erreicht" */}
        {maxedOut && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow">
            Maximum erreicht ({MAX_MARKERS} Markierungen)
          </div>
        )}
      </div>

      {/* Rückfrage beim Verwerfen */}
      {verwerfenFragen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-maja-ink/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl" role="alertdialog" aria-modal="true">
            <h3 className="text-base font-semibold text-maja-navy">Änderungen verwerfen?</h3>
            <p className="mt-1 text-sm text-maja-muted">
              Die Markierungen dieser Bearbeitung werden nicht übernommen.
              Zum Speichern unten auf „Bestätigen" tippen.
            </p>
            <div className="mt-4 grid gap-2">
              <button type="button" className="btn-primary" onClick={() => setVerwerfenFragen(false)}>
                Weiter bearbeiten
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                onClick={() => {
                  diagnose('skizze_abgebrochen', {
                    feld: feldId, verworfen: Math.abs(markers.length - initial.length),
                  });
                  setVerwerfenFragen(false);
                  onCancel();
                }}
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

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
                  onClick={() => { if (!istGeisterklick(k)) placeKind(k); }}
                  className={`flex flex-col items-center gap-1 rounded-lg p-3 text-white transition hover:opacity-90 ${KIND_BG[k]}`}
                >
                  <span className="text-2xl font-bold">{k}</span>
                  <span className="text-xs">{DAMAGE_KIND_LABEL[k]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { if (!istGeisterklick('abbrechen')) setPending(null); }}
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
