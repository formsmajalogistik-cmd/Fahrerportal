import { useMemo } from 'react';
import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/**
 * Datums-Feld. Standardmäßig MIT Uhrzeit-Input + "Jetzt"-Button
 * (field.includeTime !== false). Wird das Flag im Template auf
 * `false` gesetzt, rendert das Feld nur den Datums-Picker — für
 * Felder wie "Erstzulassung", die naturgemäß keine Uhrzeit haben.
 *
 * Speicherformat:
 *   - reines Datum:        "YYYY-MM-DD"
 *   - Datum + Uhrzeit:     "YYYY-MM-DDTHH:MM"
 *
 * Damit bleiben Alt-Eingaben (reines YYYY-MM-DD) ohne Migration
 * lesbar. Der Filterpfad in der Tourenliste / Eingaenge benutzt
 * weiterhin die ersten 10 Zeichen (slice(0,10)) und sieht damit den
 * Datumsteil.
 */
export function DateField({ field, value, onChange, disabled }: Props) {
  const { datePart, timePart } = useMemo(() => parseValue(value), [value]);
  // Default true: bestehende Templates ohne includeTime-Flag behalten
  // ihr aktuelles "Datum + Uhrzeit"-Verhalten.
  const withTime = field.includeTime !== false;

  function emit(date: string, time: string) {
    if (!date && !time) { onChange(''); return; }
    if (!date) { onChange(''); return; }
    if (!time || !withTime) { onChange(date); return; }
    onChange(`${date}T${time}`);
  }

  function setNow() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    emit(date, time);
  }

  if (!withTime) {
    return (
      <div>
        <label htmlFor={field.id} className="label">
          {field.label}{field.required && <span className="text-red-600"> *</span>}
        </label>
        <input
          id={field.id}
          type="date"
          className="input"
          value={datePart}
          onChange={(e) => emit(e.target.value, '')}
          required={field.required}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={field.id} className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={field.id}
          type="date"
          className="input flex-1 min-w-[10rem]"
          value={datePart}
          onChange={(e) => emit(e.target.value, timePart)}
          required={field.required}
          disabled={disabled}
        />
        <input
          type="time"
          className="input min-w-[7rem]"
          value={timePart}
          onChange={(e) => emit(datePart, e.target.value)}
          aria-label={`${field.label} — Uhrzeit (optional)`}
          disabled={disabled}
          step={60}
        />
        {!disabled && (
          <button
            type="button"
            onClick={setNow}
            className="inline-flex shrink-0 items-center rounded-md border border-maja-accent/40 bg-maja-accent/10 px-2.5 py-1.5 text-xs font-semibold text-maja-accent hover:bg-maja-accent/20"
            title="Aktuelles Datum + Uhrzeit eintragen"
          >
            Jetzt
          </button>
        )}
      </div>
    </div>
  );
}

function parseValue(raw: unknown): { datePart: string; timePart: string } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { datePart: '', timePart: '' };
  }
  // "YYYY-MM-DD" oder "YYYY-MM-DDTHH:MM" (oder mit Sekunden).
  const tIdx = raw.indexOf('T');
  if (tIdx === -1) {
    // Reines Datum oder Legacy-Format.
    return { datePart: raw.slice(0, 10), timePart: '' };
  }
  const datePart = raw.slice(0, tIdx);
  const after = raw.slice(tIdx + 1);
  // HH:MM (Sekunden + Zone abschneiden, falls vorhanden).
  const timePart = after.length >= 5 ? after.slice(0, 5) : '';
  return { datePart, timePart };
}
