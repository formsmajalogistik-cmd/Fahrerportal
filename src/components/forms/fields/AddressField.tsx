import type { AddressValue, FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
}

function asAddress(v: unknown): AddressValue {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return {
      strasse: typeof o.strasse === 'string' ? o.strasse : '',
      plz:     typeof o.plz === 'string' ? o.plz : '',
      stadt:   typeof o.stadt === 'string' ? o.stadt : '',
    };
  }
  return { strasse: '', plz: '', stadt: '' };
}

export function AddressField({ field, value, onChange, disabled }: Props) {
  const v = asAddress(value);
  function patch(p: Partial<AddressValue>) {
    onChange({ ...v, ...p });
  }
  const required = !!field.required;
  return (
    <div>
      <label className="label">
        {field.label}{required && <span className="text-red-600"> *</span>}
      </label>
      <div className="space-y-2">
        <input
          className="input"
          placeholder="Straße + Hausnummer"
          value={v.strasse ?? ''}
          onChange={(e) => patch({ strasse: e.target.value })}
          disabled={disabled}
        />
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <input
            className="input"
            placeholder="PLZ"
            value={v.plz ?? ''}
            onChange={(e) => patch({ plz: e.target.value })}
            disabled={disabled}
            inputMode="numeric"
          />
          <input
            className="input"
            placeholder="Stadt"
            value={v.stadt ?? ''}
            onChange={(e) => patch({ stadt: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
