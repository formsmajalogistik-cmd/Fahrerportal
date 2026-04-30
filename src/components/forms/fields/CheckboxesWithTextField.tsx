import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: Array<{ option: string; text: string }>) => void;
  disabled?: boolean;
}

interface Entry {
  option: string;
  text: string;
}

function asEntries(v: unknown): Entry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Entry =>
    !!x && typeof x === 'object'
    && typeof (x as { option?: unknown }).option === 'string'
    && typeof (x as { text?: unknown }).text === 'string'
  );
}

export function CheckboxesWithTextField({ field, value, onChange, disabled }: Props) {
  const entries = asEntries(value);
  const byOption = new Map(entries.map((e) => [e.option, e]));

  function toggle(opt: string, checked: boolean) {
    if (checked) {
      const next = [...entries, { option: opt, text: '' }];
      onChange(next);
    } else {
      onChange(entries.filter((e) => e.option !== opt));
    }
  }

  function setText(opt: string, text: string) {
    onChange(entries.map((e) => (e.option === opt ? { ...e, text } : e)));
  }

  return (
    <fieldset>
      <legend className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </legend>
      <div className="space-y-2">
        {(field.options ?? []).map((opt) => {
          const entry = byOption.get(opt);
          const isChecked = !!entry;
          return (
            <div
              key={opt}
              className="rounded-lg border border-maja-navy/20 bg-white p-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={isChecked}
                  onChange={(e) => toggle(opt, e.target.checked)}
                  disabled={disabled}
                />
                <span className="font-medium text-maja-ink">{opt}</span>
              </label>
              {isChecked && (
                <input
                  type="text"
                  className="input mt-2"
                  placeholder={`Details zu „${opt}"`}
                  value={entry?.text ?? ''}
                  onChange={(e) => setText(opt, e.target.value)}
                  disabled={disabled}
                />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
