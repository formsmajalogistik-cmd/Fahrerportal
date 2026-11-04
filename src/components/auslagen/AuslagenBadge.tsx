// Badge zum Auslagen-Status einer Tour (nur Admin) — Stil wie die
// bestehenden Rechnungs-Hinweise in der Tourenliste.

import { slotLabel, statusText, ungeklaertText, type AuslagenStatus } from '../../lib/auslagenStatus';

const STIL: Record<AuslagenStatus['art'], string> = {
  offen: 'bg-amber-100 text-amber-800',
  abgerechnet: 'bg-indigo-100 text-indigo-700 dark:!bg-indigo-900/60 dark:!text-indigo-100',
  keine: 'bg-slate-100 text-slate-600 dark:!bg-slate-700 dark:!text-slate-200',
  ungeklaert: 'bg-orange-100 text-orange-700 dark:!bg-orange-900/50 dark:!text-orange-200',
  ohne_abgerechnet: 'bg-slate-100 text-slate-600 dark:!bg-slate-700 dark:!text-slate-200',
};

const TITEL: Record<AuslagenStatus['art'], string> = {
  offen: 'Mindestens ein abrechenbarer Zusatz steht noch auf keiner Rechnung.',
  abgerechnet: 'Alle Zusätze stehen auf einer Rechnung.',
  keine: '„Keine Auslagen" gesetzt — für diese Tour fallen keine Auslagen an.',
  ungeklaert: 'Keine Auslage und kein „Keine Auslagen" erfasst.',
  ohne_abgerechnet: 'Tour ohne Zusätze bereits abgerechnet.',
};

/**
 * Status-Badge. `nurUngeklaert`: zweites Badge, wenn die Tour offen ist
 * UND Kennzeichen ungeklärt sind.
 */
export function AuslagenBadge({ status, nurUngeklaert }: { status: AuslagenStatus; nurUngeklaert?: boolean }) {
  const art = nurUngeklaert ? 'ungeklaert' : status.art;
  const warn = art === 'offen' || art === 'ungeklaert';
  const title = art === 'offen'
    ? `${TITEL.offen} Offen: ${status.offen.map((z) => z.kategorie).join(', ')}`
    : art === 'ungeklaert' ? `${status.ungeklaert.map(slotLabel).join(', ')}: ${TITEL.ungeklaert}` : TITEL[art];
  return (
    <span
      data-auslagen={art}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STIL[art]}`}
    >
      {warn && <span aria-hidden="true">⚠</span>}
      {nurUngeklaert ? ungeklaertText(status.ungeklaert) : statusText(status)}
    </span>
  );
}
