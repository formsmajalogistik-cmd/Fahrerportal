import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

export function CheckboxesField({ field, value, onChange, disabled }: Props) {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(opt: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...selected, opt]))
      : selected.filter((v) => v !== opt);
    onChange(next);
  }

  return (
    <fieldset>
      <legend className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(field.options ?? []).map((opt) => (
          <label key={opt} className="flex items-center gap-2 rounded-lg border border-maja-navy/20 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
              checked={selected.includes(opt)}
              onChange={(e) => toggle(opt, e.target.checked)}
              disabled={disabled}
            />
            <span className="text-maja-ink">{opt}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
