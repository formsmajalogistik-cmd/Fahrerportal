import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function SelectField({ field, value, onChange, disabled }: Props) {
  return (
    <div>
      <label htmlFor={field.id} className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <select
        id={field.id}
        className="input"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        disabled={disabled}
      >
        <option value="">— bitte wählen —</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
