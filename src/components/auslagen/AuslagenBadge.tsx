// Badge zum Auslagen-Status einer Tour (nur Admin) — Stil wie die
// bestehenden Rechnungs-Hinweise in der Tourenliste.

import { statusText, type AuslagenStatus } from '../../lib/auslagenStatus';

const STIL: Record<AuslagenStatus['art'], string> = {
  offen: 'bg-amber-100 text-amber-800',
  abgerechnet: 'bg-indigo-100 text-indigo-700 dark:!bg-indigo-900/60 dark:!text-indigo-100',
  keine: 'bg-slate-100 text-slate-600 dark:!bg-slate-700 dark:!text-slate-200',
  ungeklaert: 'bg-orange-100 text-orange-700 dark:!bg-orange-900/50 dark:!text-orange-200',
  ohne_abgerechnet: 'bg-slate-100 text-slate-600 dark:!bg-slate-700 dark:!text-slate-200',
};

const TITEL: Record<AuslagenStatus['art'], string> = {
  offen: 'Zusätze vorhanden, mindestens einer steht noch auf keiner Rechnung.',
  abgerechnet: 'Alle Zusätze stehen auf einer Rechnung.',
  keine: '„Keine Auslagen" gesetzt — für diese Tour fallen keine Auslagen an.',
  ungeklaert: 'Keine Zusätze erfasst und nicht als „Keine Auslagen" markiert.',
  ohne_abgerechnet: 'Tour ohne Zusätze bereits abgerechnet.',
};

export function AuslagenBadge({ status }: { status: AuslagenStatus }) {
  const warn = status.art === 'offen' || status.art === 'ungeklaert';
  return (
    <span
      data-auslagen={status.art}
      title={status.art === 'offen' ? `${TITEL.offen} Offen: ${status.offen.map((z) => z.kategorie).join(', ')}` : TITEL[status.art]}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STIL[status.art]}`}
    >
      {warn && <span aria-hidden="true">⚠</span>}
      {statusText(status)}
    </span>
  );
}
