import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}

export function NumberField({ field, value, onChange, disabled }: Props) {
  const str = value === null || value === undefined || value === '' ? '' : String(value);
  return (
    <div>
      <label htmlFor={field.id} className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <input
        id={field.id}
        type="number"
        inputMode="decimal"
        className="input"
        value={str}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') onChange(null);
          else {
            const n = Number(v);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        placeholder={field.placeholder}
        required={field.required}
        disabled={disabled}
      />
    </div>
  );
}
