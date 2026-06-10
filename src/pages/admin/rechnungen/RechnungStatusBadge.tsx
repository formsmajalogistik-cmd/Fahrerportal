import type { RechnungStatus } from '../../../types/db';

// `!`-Modifier nötig: die Bulk-Overrides in index.css (`.dark .bg-gray-100`
// usw.) stehen NACH den Tailwind-Utilities und würden die normalen
// dark:-Varianten überschreiben.
const STATUS_STYLE: Record<RechnungStatus, { bg: string; text: string; label: string }> = {
  entwurf:   { bg: 'bg-gray-100 dark:!bg-slate-600',      text: 'text-gray-700 dark:!text-slate-100',     label: 'Entwurf' },
  offen:     { bg: 'bg-blue-100 dark:!bg-blue-900',       text: 'text-blue-700 dark:!text-blue-100',      label: 'Offen' },
  bezahlt:   { bg: 'bg-emerald-100 dark:!bg-emerald-900', text: 'text-emerald-700 dark:!text-emerald-100', label: 'Bezahlt' },
};

export function RechnungStatusBadge({ status }: { status: RechnungStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
