// Aktionsleiste am Ende des Formulars.
//
// WICHTIG: Diese Leiste wird von FormularPage GENAU EINMAL gerendert —
// auf Seitenebene, NICHT innerhalb der Seiten-/Abschnitts-Darstellung.
// Beim Blättern bleibt die Komponente montiert, es ändern sich nur die
// Props. Dadurch kann weder eine alte Instanz stehen bleiben noch eine
// zweite entstehen. Bitte nicht in eine Seiten-Komponente verschieben.
//
// Feste Anordnung, die sich beim Seitenwechsel NICHT ändert:
//
//   links   PDF-Vorschau
//           "Speichern und später fortfahren"  (immer, immer sekundär)
//   rechts  die primäre Aktion der aktuellen Seite:
//             Übernahme-Seite → "Übernahme abschließen und
//                                Zwischenprotokoll versenden" (Akzent)
//             letzte Seite    → "Endgültig abschließen"
//
// Liegt der Übernahme-Teil auf der letzten Seite, erscheinen beide:
// „Endgültig abschließen" dann bewusst sekundär links daneben, damit
// immer nur EIN Button hervorgehoben ist und die beiden nicht
// verwechselt werden.

export type SaveState = 'idle' | 'draft' | 'submit';

interface Props {
  saving: SaveState;
  zwischenBusy: boolean;
  /** Nur am Ende des Übernahme-Teils und nur wenn im Template aktiviert. */
  zeigeZwischenprotokoll: boolean;
  /** "Endgültig abschließen" erscheint ausschließlich auf der letzten Seite. */
  istLetzteSeite: boolean;
  onVorschau: () => void;
  onEntwurfSpeichern: () => void;
  onZwischenprotokoll: () => void;
  onAbschliessen: () => void;
}

export function FormularAktionsleiste({
  saving, zwischenBusy, zeigeZwischenprotokoll, istLetzteSeite,
  onVorschau, onEntwurfSpeichern, onZwischenprotokoll, onAbschliessen,
}: Props) {
  const busy = saving !== 'idle';
  return (
    <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 bg-white/90 px-4 py-3 backdrop-blur">
      {/* Links: unveränderlich auf jeder Seite. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onVorschau}
          className="btn-secondary"
          disabled={busy}
          title="Vorschau der gefüllten PDF anzeigen"
        >
          PDF-Vorschau
        </button>
        <button
          type="button"
          onClick={onEntwurfSpeichern}
          className="btn-secondary"
          disabled={busy}
        >
          {saving === 'draft' ? 'Speichern …' : 'Speichern und später fortfahren'}
        </button>
      </div>

      {/* Rechts: die primäre Aktion dieser Seite. `ml-auto` +
          `justify-end` halten die Gruppe auch dann am rechten Rand,
          wenn sie neben der linken Gruppe nicht mehr in eine Zeile
          passt und umbricht — sonst spränge der Hauptbutton je nach
          Fensterbreite und Seite nach links. */}
      <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto sm:justify-end">
        {istLetzteSeite && (
          <button
            type="button"
            onClick={onAbschliessen}
            className={zeigeZwischenprotokoll ? 'btn-secondary' : 'btn-primary'}
            disabled={busy}
          >
            {saving === 'submit' ? 'Wird abgeschlossen …' : 'Endgültig abschließen'}
          </button>
        )}
        {zeigeZwischenprotokoll && (
          <button
            type="button"
            onClick={onZwischenprotokoll}
            className="btn-accent w-full whitespace-normal leading-tight sm:w-auto"
            disabled={busy || zwischenBusy}
            title="Übernahme-Teil als Zwischenprotokoll sichern und versenden — das Formular bleibt weiter bearbeitbar"
          >
            {zwischenBusy ? (
              'Sichert …'
            ) : (
              <>
                {/* Auf schmalen Breiten die kurze Variante — bewusst
                    NICHT auf „Zwischenprotokoll" verkürzt. */}
                <span className="sm:hidden">Übernahme abschließen &amp; versenden</span>
                <span className="hidden sm:inline">
                  Übernahme abschließen und Zwischenprotokoll versenden
                </span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
