// Gemeinsame Klassen der Tour-Such-/Auswahl-Dialoge:
//   * „Mit Tour verknüpfen" (Eingänge)
//   * Tour-Auswahl im Posteingang („Tour öffnen", „Zusätze …")
//   * „Tour hinzufügen" (Rechnungen)
//
// Die Dialoge sind getrennte Komponenten, sahen aber gleich aus und
// hingen im Dark Mode vollständig an der zentralen Umfärbung in
// index.css. Dort wird z.B. `bg-maja-light` zu derselben Farbe wie die
// Karte — Tour-ID-Chips verschwanden, Hover und Fokus waren kaum zu
// erkennen. Hier stehen die Dark-Farben ausdrücklich (mit `!`, weil die
// zentrale Umfärbung sonst gleichrangig gewinnt), und zwar EINMAL.

/** Abgedunkelter Hintergrund hinter dem Dialog. */
export const DIALOG_HINTERGRUND =
  'fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60';

/** Eine Ergebniszeile (Button) — Hover und Tastatur-Fokus klar sichtbar. */
export const ERGEBNIS_ZEILE =
  'flex w-full flex-wrap items-start justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 '
  + 'text-left text-sm transition hover:bg-maja-light hover:border-maja-accent/40 '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-maja-accent disabled:opacity-50 '
  + 'dark:!border-slate-600 dark:!bg-slate-800 dark:hover:!bg-slate-700 dark:hover:!border-sky-400/60 '
  + 'dark:focus-visible:ring-sky-400';

/** Wahlknopf in Unter-Dialogen (z.B. „Welcher Streckenabschnitt?"). */
export const WAHL_KNOPF =
  'rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left text-sm transition hover:bg-maja-light '
  + 'hover:border-maja-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-maja-accent '
  + 'dark:!border-slate-600 dark:!bg-slate-800 dark:hover:!bg-slate-700 dark:hover:!border-sky-400/60 '
  + 'dark:focus-visible:ring-sky-400';

/** Hintergrund eines Unter-Dialogs über dem Such-Dialog. */
export const UNTERDIALOG_HINTERGRUND =
  'fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/50 px-4 dark:bg-black/60';

/** Tour-ID-Chip in der Zeile. */
export const TOUR_ID_CHIP =
  'rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy dark:!bg-slate-600 dark:!text-white';

/** Kleines Kennzeichnungs-Badge (Tourenart wie „ABA"). */
export const ART_BADGE =
  'rounded-full bg-maja-navy/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-navy '
  + 'dark:!bg-sky-900/60 dark:!text-sky-100';

/** Hinweis-Badge (z.B. „2 Slots", „auf Eis"). */
export const HINWEIS_BADGE =
  'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:!bg-amber-900/50 dark:!text-amber-100';

/** Leerzustand („Keine Treffer"). */
export const LEER_HINWEIS = 'mt-4 text-sm text-maja-muted dark:!text-slate-300';
