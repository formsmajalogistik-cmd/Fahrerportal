import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function TextareaField({ field, value, onChange, disabled }: Props) {
  return (
    <div>
      <label htmlFor={field.id} className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <textarea
        id={field.id}
        className="input min-h-[96px]"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        disabled={disabled}
      />
    </div>
  );
}
