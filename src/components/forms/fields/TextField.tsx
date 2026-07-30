import type { FormField } from '../../../types/db';
import { SuggestCombobox } from '../../SuggestCombobox';
import { feldTypVon } from '../../../lib/feldVorschlaege';

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
    </div>
  );
}
