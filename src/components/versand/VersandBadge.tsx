// Kleines Versand-Badge je Rechnung/Gutschrift in Übersicht und Detail.
// Tooltip (title) mit Datum, Empfänger bzw. Weg.

import { statusTooltip, type VersandStatus } from '../../lib/belegVersand';

const STIL: Record<Exclude<VersandStatus['art'], 'ohne'>, { text: string; cls: string }> = {
  app: { text: '✓ versendet', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  manuell: { text: '✓ markiert', cls: 'bg-sky-100 text-sky-800 border-sky-200 dark:!border-sky-400/30' },
  nicht_versendet: { text: '⚠ nicht versendet', cls: 'bg-amber-50 text-amber-900 border-amber-300' },
  fehlgeschlagen: { text: '✕ fehlgeschlagen', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export function VersandBadge({ status, kompakt }: { status: VersandStatus; kompakt?: boolean }) {
  if (status.art === 'ohne') return <span className="text-xs text-maja-muted" title={statusTooltip(status)}>—</span>;
  const s = STIL[status.art];
  return (
    <span
      title={statusTooltip(status)}
      data-versand={status.art}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}
    >
      {kompakt ? s.text.split(' ')[0] : s.text}
      {status.fehlerDanach && status.letzter && <span aria-label="danach fehlgeschlagener Versuch">·✕</span>}
    </span>
  );
}
