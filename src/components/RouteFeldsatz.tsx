// Route-Block: Start-, Ziel- und Rückführung-Stadt an der Stelle, an
// der die Tour auch in der Liste erscheint ("Bremen → München").
//
// Wichtig: Es sind DIESELBEN Werte wie das Stadt-Feld im jeweiligen
// Ort-Block (Migration 086). Beide Stellen sind an denselben State
// gebunden — eine Eingabe hier erscheint sofort im Adressblock und
// umgekehrt. Damit kann es keine zwei widersprüchlichen Städte geben.

import { TfBlock } from './TfBlock';

interface Props {
  startStadt: string;
  onStartStadt: (v: string) => void;
  zielStadt: string;
  onZielStadt: (v: string) => void;
  /** Rückführung nur bei ABA/ABC — sonst weglassen. */
  rueckStadt?: string;
  onRueckStadt?: (v: string) => void;
  pflicht?: boolean;
  startFehler?: boolean;
  zielFehler?: boolean;
  rueckFehler?: boolean;
  idPrefix: string;
}

export function RouteFeldsatz({
  startStadt, onStartStadt, zielStadt, onZielStadt,
  rueckStadt, onRueckStadt, pflicht, startFehler, zielFehler, rueckFehler,
  idPrefix,
}: Props) {
  const cls = (fehler?: boolean) => (fehler ? 'tf-input border-red-500' : 'tf-input');
  const hatRueck = onRueckStadt != null;
  const route = [startStadt, zielStadt, hatRueck ? rueckStadt : '']
    .map((s) => (s ?? '').trim()).filter(Boolean).join(' → ');
  return (
    <TfBlock
      titel="Route"
      aktion={route ? (
        <span className="normal-case tracking-normal text-maja-ink">{route}</span>
      ) : undefined}
    >
      <div className="tf-grid">
        <div className="sm:col-span-3 lg:col-span-4">
          <label htmlFor={`${idPrefix}-r-start`} className="tf-label">
            Start-Stadt{pflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-r-start`} className={cls(startFehler)}
                 value={startStadt} onChange={(e) => onStartStadt(e.target.value)} />
        </div>
        <div className="sm:col-span-3 lg:col-span-4">
          <label htmlFor={`${idPrefix}-r-ziel`} className="tf-label">
            Ziel-Stadt{pflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-r-ziel`} className={cls(zielFehler)}
                 value={zielStadt} onChange={(e) => onZielStadt(e.target.value)} />
        </div>
        {hatRueck && (
          <div className="sm:col-span-3 lg:col-span-4">
            <label htmlFor={`${idPrefix}-r-rueck`} className="tf-label">
              Rückführung-Stadt
            </label>
            <input id={`${idPrefix}-r-rueck`} className={cls(rueckFehler)}
                   value={rueckStadt ?? ''} onChange={(e) => onRueckStadt?.(e.target.value)} />
          </div>
        )}
        <div className="sm:col-span-6 lg:col-span-12">
          <p className="tf-hint">
            Dieselben Städte stehen im jeweiligen Ort-Block bei der Adresse —
            beide Stellen bearbeiten denselben Wert.
          </p>
        </div>
      </div>
    </TfBlock>
  );
}
