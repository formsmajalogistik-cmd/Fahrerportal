// Zeitraum-Schnellwahl der Tourenliste: vier sichtbare Knöpfe (Vortag,
// Nächster Tag, Diese Woche, Aktueller Monat) und „Weitere Zeiträume ▾"
// für den Rest. Ist ein Dropdown-Zeitraum aktiv, trägt der Knopf dessen
// Namen und ist hervorgehoben („Aktuelles Jahr ▾"). Von Hand geänderte
// Daten → kein Schnellfilter aktiv. Logik: lib/zeitraeume.ts.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { aktiverZeitraum, zeitraeume, type Zeitraum } from '../lib/zeitraeume';

interface Props {
  von: string;
  bis: string;
  onChange: (von: string, bis: string) => void;
  /** Für Tests/Harness überschreibbar. */
  heute?: Date;
}

/** Gleiche Pill-Optik wie die Status-Pills, mit ausdrücklichen Dark-Farben. */
function zeitraumPillCls(aktiv: boolean): string {
  return `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition `
    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-maja-accent dark:focus-visible:ring-sky-400 '
    + (aktiv
      ? 'bg-maja-navy text-white dark:!bg-sky-600 dark:!text-white'
      : 'border border-maja-navy/15 bg-white text-maja-navy hover:bg-maja-light dark:!border-slate-600');
}

export function ZeitraumFilter({ von, bis, onChange, heute }: Props) {
  // Der Tag wechselt selten — einmal pro Render neu zu rechnen ist billig
  // und hält „Vortag" nach Mitternacht korrekt.
  const tagKey = (heute ?? new Date()).toDateString();
  const liste = useMemo(() => zeitraeume(new Date(tagKey)), [tagKey]);
  const aktiv = aktiverZeitraum(liste, von, bis);
  const monat = liste.find((z) => z.key === 'monat')!;
  const schnell = liste.filter((z) => z.gruppe === 'schnell');
  const weitere = liste.filter((z) => z.gruppe === 'weitere');
  const weitereAktiv = aktiv && aktiv.gruppe === 'weitere' ? aktiv : null;

  const [offen, setOffen] = useState(false);
  const [rechtsbuendig, setRechtsbuendig] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!offen) return;
    const weg = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOffen(false);
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOffen(false); knopfRef.current?.focus(); }
    };
    document.addEventListener('mousedown', weg);
    document.addEventListener('touchstart', weg);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('mousedown', weg);
      document.removeEventListener('touchstart', weg);
      document.removeEventListener('keydown', taste);
    };
  }, [offen]);

  function waehle(z: Zeitraum) {
    // Tages-Knöpfe: zweiter Klick stellt den Monats-Standard wieder her.
    if (z.tag && aktiv?.key === z.key) onChange(monat.von, monat.bis);
    else onChange(z.von, z.bis);
    setOffen(false);
  }

  function umschalten() {
    if (!offen && knopfRef.current) {
      // Menü (14 rem) nicht über den rechten Rand laufen lassen — auf dem
      // Handy landet der Knopf je nach Umbruch auch weit rechts.
      const r = knopfRef.current.getBoundingClientRect();
      setRechtsbuendig(r.left + 224 > window.innerWidth - 8);
    }
    setOffen((o) => !o);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Zeitraum">
      {schnell.map((z) => (
        <button key={z.key} type="button" className={zeitraumPillCls(aktiv?.key === z.key)}
                aria-pressed={aktiv?.key === z.key} title={z.title} onClick={() => waehle(z)}>
          {z.label}
        </button>
      ))}
      <div ref={wrapRef} className="relative">
        <button
          ref={knopfRef}
          type="button"
          className={zeitraumPillCls(!!weitereAktiv)}
          aria-haspopup="true"
          aria-expanded={offen}
          aria-controls={menuId}
          onClick={umschalten}
        >
          {weitereAktiv ? weitereAktiv.label : 'Weitere Zeiträume'}
          <span aria-hidden="true" className="text-xs">▾</span>
        </button>
        {offen && (
          <ul
            id={menuId}
            className={`absolute z-20 mt-1 w-56 overflow-hidden rounded-xl border border-maja-navy/15 bg-white py-1 shadow-lg dark:!border-slate-600 dark:!bg-slate-800 ${
              rechtsbuendig ? 'right-0' : 'left-0'
            }`}
          >
            {weitere.map((z) => {
              const an = aktiv?.key === z.key;
              return (
                <li key={z.key}>
                  <button
                    type="button"
                    title={z.title}
                    aria-current={an ? 'true' : undefined}
                    onClick={() => waehle(z)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition focus:outline-none ${
                      an
                        ? 'bg-maja-navy/10 font-semibold text-maja-navy dark:!bg-sky-900/60 dark:!text-white'
                        : 'text-maja-ink hover:bg-maja-light focus-visible:bg-maja-light dark:hover:!bg-slate-700 dark:focus-visible:!bg-slate-700'
                    }`}
                  >
                    {z.label}
                    {an && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
