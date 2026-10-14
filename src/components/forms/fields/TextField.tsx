import type { FormField } from '../../../types/db';
import { SuggestCombobox } from '../../SuggestCombobox';
import { feldTypVon } from '../../../lib/feldVorschlaege';
import { kennzeichenAuffaellig } from '../../../lib/onedrivePaths';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function TextField({ field, value, onChange, disabled }: Props) {
  // Ist für dieses Feld "Vorschläge aktivieren" gesetzt, wird aus dem
  // Textfeld eine Combobox — freie Eingabe bleibt möglich.
  const feldTyp = feldTypVon(field);
  // Kennzeichen mit ungewöhnlichem Format (z.B. „WÜ-IT...E"): nur ein
  // Hinweis, nie blockieren — provisorische/ausländische Kennzeichen
  // müssen möglich bleiben. Der Wert wird unverändert gespeichert.
  const istKennzeichen = /^kennzeichen/i.test(field.id);
  const hinweis = istKennzeichen && kennzeichenAuffaellig(value);
  return (
    <div>
      <label htmlFor={field.id} className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <SuggestCombobox
        id={field.id}
        feldTyp={feldTyp}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        placeholder={field.placeholder}
        required={field.required}
        disabled={disabled}
      />
      {hinweis && (
        <p className="mt-1 text-xs text-amber-700 dark:!text-amber-300">
          Bitte Kennzeichen prüfen.
        </p>
      )}
    </div>
  );
}
