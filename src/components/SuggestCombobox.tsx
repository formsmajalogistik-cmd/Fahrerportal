// Textfeld mit Vorschlagsliste (Migration 077).
//
// Bewusst KEIN <datalist>: das rendert der Browser selbst, ignoriert
// Tailwind und sieht im Dark Mode fremd aus. Diese Combobox ist optisch
// an den Favoriten-Dropdown der E-Mail-Empfänger angelehnt.
//
// Verhalten:
//   * Fokus/Klick  → Dropdown mit den Top-Vorschlägen (max. 8).
//   * Tippen       → filtert live (Teilstring, Groß-/Kleinschreibung egal).
//   * Klick/Enter  → übernimmt den Wert; freie Eingabe bleibt jederzeit
//                    möglich, es ist ein Textfeld mit Vorschlägen.
//   * ↑/↓          → Auswahl bewegen, Escape / Klick daneben schließt.
//   * Mobil        → große Tap-Ziele; die Liste klappt nach OBEN, wenn
//                    unterhalb kein Platz ist (Tastatur).

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type KeyboardEvent,
} from 'react';
import { ladeVorschlaege } from '../lib/feldVorschlaege';

/** Wie viele Vorschläge maximal gleichzeitig sichtbar sind. */
const MAX_SICHTBAR = 8;
/** Ab so wenig Platz unterhalb des Feldes klappt die Liste nach oben. */
const MIN_PLATZ_UNTEN = 200;

interface Props {
  /** Pool-Schlüssel; leer/undefined = ganz normales Textfeld. */
  feldTyp?: string | null;
  value: string;
  onChange: (v: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'numeric';
  autoComplete?: string;
  /** Tooltip am Eingabefeld (z.B. der Stadt-Kopplungshinweis). */
  title?: string;
  'aria-label'?: string;
}

export function SuggestCombobox({
  feldTyp, value, onChange, id, className = 'input', placeholder,
  required, disabled, inputMode, autoComplete = 'off', title,
  'aria-label': ariaLabel,
}: Props) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const listId = `${inputId}-liste`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [alle, setAlle] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [aktiv, setAktiv] = useState(-1);
  const [nachOben, setNachOben] = useState(false);
  const [maxH, setMaxH] = useState(288);
  const aktiviert = !!feldTyp && !disabled;

  // Erst beim ersten Fokus laden — ein Formular hat viele Felder, und
  // die meisten werden nie angefasst.
  const [geladen, setGeladen] = useState(false);
  const laden = useCallback(() => {
    if (!aktiviert || geladen) return;
    setGeladen(true);
    void ladeVorschlaege(feldTyp!).then((werte) => setAlle(werte));
  }, [aktiviert, geladen, feldTyp]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(ev: MouseEvent | TouchEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, [open]);

  const treffer = useMemo(() => {
    if (!aktiviert) return [];
    const q = value.trim().toLowerCase();
    const gefiltert = q
      ? alle.filter((w) => w.toLowerCase().includes(q))
      : alle;
    // Exakte Eingabe nicht als einzigen Vorschlag anbieten.
    if (gefiltert.length === 1 && gefiltert[0].toLowerCase() === q) return [];
    return gefiltert.slice(0, MAX_SICHTBAR);
  }, [aktiviert, alle, value]);

  /**
   * Platz messen: passt die Liste unter das Feld, oder muss sie darüber?
   * Maßgeblich ist das visualViewport — auf Mobilgeräten schrumpft es,
   * wenn die Tastatur aufgeht, während innerHeight gleich bleibt.
   */
  const pruefePlatz = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    // getBoundingClientRect ist relativ zum Layout-Viewport; offsetTop
    // rechnet die Verschiebung durch die Tastatur heraus.
    const sichtbarUnten = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const unten = sichtbarUnten - rect.bottom;
    const oben = rect.top - (vv ? vv.offsetTop : 0);
    const obenBesser = unten < MIN_PLATZ_UNTEN && oben > unten;
    setNachOben(obenBesser);
    // Liste nie über den sichtbaren Bereich hinauslaufen lassen.
    setMaxH(Math.max(120, Math.round((obenBesser ? oben : unten) - 12)));
  }, []);

  // Solange die Liste offen ist, auf Tastatur/Scroll reagieren.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const onResize = () => pruefePlatz();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, [open, pruefePlatz]);

  function oeffnen() {
    if (!aktiviert) return;
    laden();
    pruefePlatz();
    setAktiv(-1);
    setOpen(true);
  }

  function uebernehmen(wert: string) {
    onChange(wert);
    setOpen(false);
    setAktiv(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (!aktiviert) return;
    if (ev.key === 'Escape') {
      if (open) { ev.stopPropagation(); setOpen(false); setAktiv(-1); }
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!open) { oeffnen(); return; }
      if (treffer.length === 0) return;
      ev.preventDefault();
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
      setAktiv((cur) => {
        const next = cur + delta;
        if (next < 0) return treffer.length - 1;
        if (next >= treffer.length) return 0;
        return next;
      });
      return;
    }
    if (ev.key === 'Enter' && open && aktiv >= 0 && aktiv < treffer.length) {
      // Nur wenn wirklich ein Vorschlag markiert ist — sonst soll Enter
      // wie gewohnt das Formular bedienen.
      ev.preventDefault();
      uebernehmen(treffer[aktiv]);
      return;
    }
    if (ev.key === 'Tab') setOpen(false);
  }

  const zeigen = open && aktiviert && treffer.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (aktiviert) { laden(); pruefePlatz(); setAktiv(-1); setOpen(true); }
        }}
        onFocus={oeffnen}
        onClick={oeffnen}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        title={title}
        aria-label={ariaLabel}
        role={aktiviert ? 'combobox' : undefined}
        aria-expanded={aktiviert ? zeigen : undefined}
        aria-controls={aktiviert ? listId : undefined}
        aria-autocomplete={aktiviert ? 'list' : undefined}
        aria-activedescendant={
          zeigen && aktiv >= 0 ? `${listId}-${aktiv}` : undefined
        }
      />
      {zeigen && (
        <ul
          id={listId}
          role="listbox"
          style={{ maxHeight: `${maxH}px` }}
          className={
            'absolute z-30 w-full overflow-auto rounded-md border '
            + 'border-maja-navy/15 bg-white shadow-lg '
            + (nachOben ? 'bottom-full mb-1' : 'top-full mt-1')
          }
        >
          {treffer.map((wert, i) => (
            <li key={wert} id={`${listId}-${i}`} role="option" aria-selected={i === aktiv}>
              <button
                type="button"
                // Vor dem Blur zuschlagen, sonst schließt die Liste
                // auf Mobilgeräten weg, bevor der Klick ankommt.
                onMouseDown={(e) => { e.preventDefault(); uebernehmen(wert); }}
                onTouchStart={(e) => { e.preventDefault(); uebernehmen(wert); }}
                onMouseEnter={() => setAktiv(i)}
                className={
                  'block w-full truncate border-b border-maja-navy/5 px-3 py-2.5 '
                  + 'text-left text-sm text-maja-ink last:border-b-0 '
                  // Akzentfarbe statt bg-maja-light: die deckt sich im
                  // Dark Mode mit dem Listen-Hintergrund.
                  + (i === aktiv ? 'bg-maja-accent/25' : 'hover:bg-maja-accent/15')
                }
              >
                {wert}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
