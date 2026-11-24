// Darstellung der „Internen Info (nur Admin)" (Migration 120) — einheitlich
// mit Schloss-Symbol und Kennzeichnung „Nur Admin". Nur in Admin-Ansichten
// verwenden; die Daten liefert ohnehin nur die Datenbank an Admins aus.
import type { ReactNode } from 'react';

export function SchlossIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path fillRule="evenodd" d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z" clipRule="evenodd" />
    </svg>
  );
}

/** Überschrift „Interne Info · Nur Admin" mit Schloss. */
export function InterneInfoTitel({ htmlFor, className = '' }: { htmlFor?: string; className?: string }) {
  const inhalt: ReactNode = (
    <>
      <SchlossIcon />
      <span>Interne Info</span>
      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:!bg-violet-900/60 dark:!text-violet-100">Nur Admin</span>
    </>
  );
  const cls = `inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet-800 dark:!text-violet-200 ${className}`;
  return htmlFor ? <label htmlFor={htmlFor} className={cls}>{inhalt}</label> : <div className={cls}>{inhalt}</div>;
}

/** Kompakte Zeile, z.B. unter einer Rechnungsposition. Wird nie gedruckt. */
export function InterneInfoZeile({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1 text-xs italic text-violet-800 dark:!text-violet-200" data-testid="interne-info-zeile"
       title="Interne Info (nur Admin) — wird NICHT auf die Rechnung gedruckt">
      <SchlossIcon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="whitespace-pre-wrap">Intern: {text}</span>
    </p>
  );
}
