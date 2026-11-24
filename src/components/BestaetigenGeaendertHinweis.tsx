// Hinweis, wenn der Auftraggeber einen Auftrag zwischen Laden und
// „Bestätigen" geändert hat (Migration 119): Bestätigen wurde angehalten,
// die geänderten Felder werden gezeigt, die Daten neu geladen.
import { BESTAETIGEN_GEAENDERT_TEXT, aenderungSatz, feldLabel, wertLabel } from '../lib/tourAenderungen';

interface Props {
  tourNr?: string | null;
  geaendert: Array<{ feld: string; alt: string | null; neu: string | null }>;
  onSchliessen?: () => void;
}

export function BestaetigenGeaendertHinweis({ tourNr, geaendert, onSchliessen }: Props) {
  return (
    <div role="alert" data-testid="bestaetigen-geaendert"
         className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:!border-orange-500/60 dark:!bg-orange-950/40 dark:!text-orange-100">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {tourNr ? `${tourNr}: ` : ''}{BESTAETIGEN_GEAENDERT_TEXT}
        </p>
        {onSchliessen && (
          <button type="button" className="shrink-0 text-xs underline" onClick={onSchliessen}>Schließen</button>
        )}
      </div>
      {geaendert.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
          {geaendert.map((g) => (
            <li key={g.feld}>
              {aenderungSatz(g.feld, g.neu, g.alt) ?? (
                <>
                  <span className="font-medium">{feldLabel(g.feld)}:</span>{' '}
                  <span className="line-through opacity-70">{wertLabel(g.feld, g.alt)}</span>{' → '}
                  <span className="font-medium">{wertLabel(g.feld, g.neu)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
