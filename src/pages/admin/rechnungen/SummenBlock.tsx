import { berechneSummenProUst, type UstGroup } from '../../../lib/rechnungsformat';
import { formatEuro } from '../../../lib/touren';

interface Props {
  positionen: Array<{ gesamtpreis: number; ust_satz?: number | null }>;
  defaultSatz: number;
  /** Bei true: Brutto-Zeile fett mit Top-Border (Layout für die letzte
   *  Sektion auf der Rechnung-/Detail-Seite). */
  prominent?: boolean;
}

/**
 * Zeigt Netto / USt (pro Satz) / Brutto an. Wenn alle Positionen den
 * gleichen Satz haben (oder keinen eigenen), wird eine einzige USt-
 * Zeile gerendert; sonst eine Zeile pro vorkommendem Satz mit Netto-
 * Bezugsbetrag.
 */
export function SummenBlock({ positionen, defaultSatz, prominent }: Props) {
  const sum = berechneSummenProUst(positionen, defaultSatz);
  const single = sum.groups.length <= 1;

  return (
    <div className="space-y-1">
      <Line label="Netto" value={sum.netto} />
      {single ? (
        <Line
          label={`${formatPercent(sum.groups[0]?.satz ?? defaultSatz)}% USt.`}
          value={sum.groups[0]?.ust ?? 0}
        />
      ) : (
        sum.groups.map((g: UstGroup) => (
          <Line
            key={g.satz}
            label={`${formatPercent(g.satz)}% USt. auf ${formatEuro(g.netto)}`}
            value={g.ust}
          />
        ))
      )}
      <Line label="Brutto" value={sum.brutto} bold={prominent} />
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between border-t border-maja-navy/10 py-1.5 text-sm ${
        bold ? 'border-t-2 border-maja-navy font-semibold text-maja-navy' : 'text-maja-ink'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatEuro(value)}</span>
    </div>
  );
}

function formatPercent(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}
