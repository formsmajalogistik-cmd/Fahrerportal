// Auswahl „Auftraggeber · Niederlassung" in EINEM Feld, durchsuchbar
// (Name, Bezeichnung, Ort, PLZ). Ohne Niederlassungen sieht die Liste aus
// wie bisher (nur Namen). Wert: „agId" (Hauptsitz) bzw. „agId:nlId".
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { standortOptionen, type Standorte, type StandortOption } from '../lib/niederlassungen';

interface Props {
  standorte: Standorte | null;
  /** „agId" oder „agId:nlId"; '' = nichts gewählt */
  wert: string;
  onChange: (wert: string, option: StandortOption | null) => void;
  id?: string;
  /** Text der Leer-Option (z.B. „— kein Auftraggeber —"); null = keine Leer-Option */
  leerText?: string | null;
  /** Nur Standorte dieses Auftraggebers anbieten (z.B. Auftraggeber-Konto). */
  nurAuftraggeber?: string | null;
  /** Zusätzliche Optionen oben (z.B. „Manueller Empfänger"). */
  extraOptionen?: Array<{ wert: string; label: string }>;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** CSS-Klasse des Eingabefelds (Standard: „input“). */
  inputClassName?: string;
  ariaLabel?: string;
}

export function StandortAuswahl({
  standorte, wert, onChange, id, leerText = '— bitte wählen —', nurAuftraggeber, extraOptionen = [],
  disabled, required, className, inputClassName = 'input', ariaLabel,
}: Props) {
  const autoId = useId();
  const listId = `${id ?? autoId}-liste`;
  const optionen = useMemo(() => standortOptionen(standorte, { inklusiveWert: wert, nurAuftraggeber }), [standorte, wert, nurAuftraggeber]);
  const alle = useMemo(() => [
    ...extraOptionen.map((e) => ({ wert: e.wert, label: e.label, such: e.label.toLowerCase(), aktiv: true, auftraggeberId: '', niederlassungId: null })),
    ...optionen,
  ] as StandortOption[], [extraOptionen, optionen]);
  const gewaehlt = alle.find((o) => o.wert === wert) ?? null;
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [aktivIdx, setAktivIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const l = q ? alle.filter((o) => o.such.includes(q) || o.label.toLowerCase().includes(q)) : alle;
    return l.filter((o) => o.aktiv || o.wert === wert);
  }, [alle, suche, wert]);

  useEffect(() => {
    if (!offen) return;
    const zu = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOffen(false); };
    document.addEventListener('mousedown', zu);
    return () => document.removeEventListener('mousedown', zu);
  }, [offen]);

  function waehlen(o: StandortOption | null) {
    onChange(o?.wert ?? '', o && o.auftraggeberId ? o : null);
    setOffen(false);
    setSuche('');
  }

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`} data-standort-auswahl>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={offen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-required={required || undefined}
        autoComplete="off"
        className={`${inputClassName} pr-8`}
        disabled={disabled}
        placeholder={gewaehlt ? gewaehlt.label : (leerText ?? 'Suchen …')}
        value={offen ? suche : (gewaehlt?.label ?? '')}
        onFocus={() => { setOffen(true); setSuche(''); setAktivIdx(Math.max(0, treffer.findIndex((o) => o.wert === wert))); }}
        onChange={(e) => { setSuche(e.target.value); setOffen(true); setAktivIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOffen(true); setAktivIdx((i) => Math.min(i + 1, treffer.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAktivIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && offen) { e.preventDefault(); if (treffer[aktivIdx]) waehlen(treffer[aktivIdx]); }
          else if (e.key === 'Escape') { setOffen(false); setSuche(''); }
        }}
      />
      <button type="button" tabIndex={-1} aria-hidden="true" disabled={disabled}
              className="absolute inset-y-0 right-0 px-2 text-maja-muted"
              onClick={() => setOffen((o) => !o)}>▾</button>
      {offen && !disabled && (
        <ul id={listId} role="listbox"
            className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-maja-navy/15 bg-white py-1 text-sm shadow-lg dark:!bg-slate-800">
          {leerText !== null && !suche && (
            <li role="option" aria-selected={!wert}
                className="cursor-pointer px-3 py-1.5 text-maja-muted hover:bg-maja-light"
                onMouseDown={(e) => { e.preventDefault(); waehlen(null); }}>{leerText}</li>
          )}
          {treffer.length === 0 && <li className="px-3 py-1.5 text-maja-muted">Nichts gefunden.</li>}
          {treffer.map((o, i) => (
            <li key={o.wert} role="option" aria-selected={o.wert === wert}
                className={`cursor-pointer px-3 py-1.5 ${i === aktivIdx ? 'bg-maja-light' : ''} ${o.wert === wert ? 'font-medium' : ''} ${o.niederlassungId || (o.auftraggeberId && o.label.includes(' · ')) ? 'pl-5' : ''} text-maja-ink hover:bg-maja-light`}
                onMouseEnter={() => setAktivIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); waehlen(o); }}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
