import type { RechnungStatus } from '../../../types/db';

const STATUS_STYLE: Record<RechnungStatus, { bg: string; text: string; label: string }> = {
  entwurf:   { bg: 'bg-gray-100',     text: 'text-gray-700',     label: 'Entwurf' },
  offen:     { bg: 'bg-blue-100',     text: 'text-blue-700',     label: 'Offen' },
  bezahlt:   { bg: 'bg-emerald-100',  text: 'text-emerald-700',  label: 'Bezahlt' },
  storniert: { bg: 'bg-red-100',      text: 'text-red-700',      label: 'Storniert' },
};

export function RechnungStatusBadge({ status }: { status: RechnungStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
