import { useEffect, useMemo, useState } from 'react';
import { XIcon } from './icons';
import { Spinner } from './Spinner';
import {
  calculateRoute, formatDuration, RouteCalcError, type RouteSuggestion,
} from '../lib/routes';

interface Props {
  /** Sichtbarer Titel oben im Dialog — z.B. "Routen für Hin-Strecke". */
  title: string;
  /** Zur Anzeige der Strecke im Header. */
  origin: string;
  destination: string;
  onClose: () => void;
  /** Wird mit der gewählten Strecke (km) aufgerufen. */
  onApply: (distanceKm: number, route: RouteSuggestion) => void;
}

/**
 * Modaler Dialog zur Auswahl einer Google-Routes-Vorschlags.
 * Lädt die Routen direkt beim Mount; bei Fehler bleibt der Dialog
 * offen mit Fehlermeldung und Retry-Button — der Admin kann jederzeit
 * abbrechen und stattdessen den km-Wert manuell eingeben.
 */
export function RouteSelectorDialog({
  title, origin, destination, onClose, onApply,
}: Props) {
  const [routes, setRoutes] = useState<RouteSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // setState im Async-Block, NICHT synchron im Effect-Body — der
    // React-19-Linter (react-hooks/set-state-in-effect) verbietet
    // synchrone setState-Calls direkt im Effect, weil sie Cascading-
    // Renders auslösen können. async läuft im Mikrotask danach.
    void (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const list = await calculateRoute({ origin, destination });
        if (cancelled) return;
        setRoutes(list);
        setPickedIdx(list.length > 0 ? list[0].index : null);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof RouteCalcError ? err : null;
        if (e?.status === 422) {
          setError('Adresse nicht gefunden. Bitte prüfe die Adresse oder gib die km manuell ein.');
        } else {
          setError(
            (err instanceof Error ? err.message : 'Unbekannter Fehler')
            + ' — Routenberechnung fehlgeschlagen, bitte km manuell eingeben.',
          );
        }
        setRoutes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [origin, destination, reloadKey]);

  /** Labels: kürzeste hat immer Label, schnellste wenn unterschiedlich. */
  const labels = useMemo(() => {
    const map = new Map<number, string[]>();
    if (routes.length === 0) return map;
    const shortest = routes.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a), routes[0]);
    const fastest = routes.reduce((a, b) => (b.durationMinutes < a.durationMinutes ? b : a), routes[0]);
    const push = (idx: number, t: string) => {
      const list = map.get(idx) ?? [];
      list.push(t);
      map.set(idx, list);
    };
    push(shortest.index, 'Kürzeste');
    if (fastest.index !== shortest.index) push(fastest.index, 'Schnellste');
    return map;
  }, [routes]);

  function handleApply() {
    if (pickedIdx == null) return;
    const route = routes.find((r) => r.index === pickedIdx);
    if (!route) return;
    onApply(route.distanceKm, route);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-maja-navy">{title}</h2>
            <p className="mt-1 truncate text-xs text-maja-muted">
              {origin} → {destination}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen"><XIcon className="h-4 w-4" /></button>
        </div>

        {loading && (
          <div className="py-6">
            <Spinner label="Routen werden berechnet …" />
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="space-y-3">
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Erneut versuchen
              </button>
              <button type="button" className="btn-primary" onClick={onClose}>
                Schließen
              </button>
            </div>
          </div>
        )}

        {!loading && !error && routes.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-maja-muted">Keine Routen gefunden.</p>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={onClose}>Schließen</button>
            </div>
          </div>
        )}

        {!loading && !error && routes.length > 0 && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">Routen-Vorschläge</legend>
              {routes.map((r) => {
                const myLabels = labels.get(r.index) ?? [];
                const active = pickedIdx === r.index;
                return (
                  <label
                    key={r.index}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition ${
                      active
                        ? 'border-maja-navy bg-maja-light'
                        : 'border-maja-navy/15 hover:bg-maja-light/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="route"
                      className="mt-1 h-4 w-4 text-maja-navy"
                      checked={active}
                      onChange={() => setPickedIdx(r.index)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-base font-semibold text-maja-navy">
                          {r.distanceKm} km
                        </span>
                        <span className="text-sm text-maja-muted">
                          — {r.description}
                        </span>
                        {myLabels.map((l) => (
                          <span
                            key={l}
                            className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                      <div className="mt-0.5 text-xs text-maja-muted">
                        Fahrtdauer: {formatDuration(r.durationMinutes)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleApply}
                disabled={pickedIdx == null}
              >
                Übernehmen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
