import type { GutschriftStatus } from '../../../lib/gutschriften';

// Gleiche Mechanik wie beim Rechnungs-Badge: der `!`-Modifier ist nötig,
// weil die Bulk-Overrides in index.css (`.dark .bg-gray-100` usw.) nach
// den Tailwind-Utilities stehen und die dark:-Varianten sonst schlagen.
const STATUS_STYLE: Record<GutschriftStatus, { bg: string; text: string; label: string }> = {
  entwurf: { bg: 'bg-gray-100 dark:!bg-slate-600',    text: 'text-gray-700 dark:!text-slate-100',    label: 'Entwurf' },
  final:   { bg: 'bg-emerald-100 dark:!bg-emerald-900', text: 'text-emerald-700 dark:!text-emerald-100', label: 'Final' },
};

export function GutschriftStatusBadge({ status }: { status: GutschriftStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
