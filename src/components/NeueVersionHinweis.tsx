// Leiste „Neue Version — bitte neu laden", wenn ein nachgeladener
// Programmteil fehlt, aber wegen ungesicherter Daten NICHT automatisch
// neu geladen wird (siehe lib/neueVersion.ts).
import { useEffect, useState } from 'react';
import { NEUE_VERSION_EVENT, jetztNeuLaden } from '../lib/neueVersion';

export function NeueVersionHinweis() {
  const [offen, setOffen] = useState<string[] | null>(null);
  useEffect(() => {
    const zeigen = (e: Event) => setOffen(((e as CustomEvent<{ offen?: string[] }>).detail?.offen) ?? []);
    window.addEventListener(NEUE_VERSION_EVENT, zeigen);
    return () => window.removeEventListener(NEUE_VERSION_EVENT, zeigen);
  }, []);
  if (!offen) return null;
  return (
    <div role="status" data-testid="neue-version-hinweis"
         className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:!border-amber-500/60 dark:!bg-amber-900/90 dark:!text-amber-50">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
        <span>
          <strong>Neue Version verfügbar.</strong>{' '}
          {offen.length > 0
            ? 'Bitte zuerst die laufende Eingabe bzw. den laufenden Vorgang abschließen (wird gespeichert), dann neu laden.'
            : 'Bitte neu laden, um fortzufahren.'}
        </span>
        <span className="flex gap-2">
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setOffen(null)}>Später</button>
          <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={jetztNeuLaden}>Neu laden</button>
        </span>
      </div>
    </div>
  );
}
