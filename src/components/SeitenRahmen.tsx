// Rahmen um nachgeladene Seiten: Ladeanzeige und — falls der Programmteil
// nach einem Deploy nicht mehr existiert — der Hinweis „Neue Version"
// statt eines weißen Bildschirms.
import { Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { Spinner } from './Spinner';
import { istChunkLadefehler, jetztNeuLaden } from '../lib/neueVersion';

export function NeueVersionKarte() {
  return (
    <div role="alert" className="card mx-auto my-8 max-w-lg space-y-3 p-6 text-sm" data-testid="neue-version-karte">
      <h2 className="text-base font-semibold text-maja-navy">Neue Version verfügbar</h2>
      <p className="text-maja-ink">
        Die App wurde aktualisiert. Diese Seite gehört schon zur neuen Version und kann erst nach dem
        Neuladen angezeigt werden. Gespeicherte Entwürfe und wartende Uploads bleiben dabei erhalten.
      </p>
      <button type="button" className="btn-primary" onClick={jetztNeuLaden}>Neu laden</button>
    </div>
  );
}

export function SeitenRahmen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={({ error, reset }) => istChunkLadefehler(error) ? <NeueVersionKarte /> : (
        <div role="alert" className="card mx-auto my-8 max-w-lg space-y-3 p-6 text-sm">
          <h2 className="text-base font-semibold text-red-700">Etwas ist schiefgelaufen</h2>
          <pre className="max-h-40 overflow-auto rounded bg-red-50 p-3 text-xs text-red-900">{error.message}</pre>
          <button type="button" className="btn-secondary" onClick={reset}>Erneut versuchen</button>
        </div>
      )}
    >
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner label="Wird geladen …" /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
