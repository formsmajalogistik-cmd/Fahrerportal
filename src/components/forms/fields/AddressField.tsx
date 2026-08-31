import type { AddressValue, FormField } from '../../../types/db';
import { SuggestCombobox } from '../../SuggestCombobox';
import { AdressUebernehmen } from '../../AdressUebernehmen';
import { adressTeilTyp, feldTypVon } from '../../../lib/feldVorschlaege';
import { useAdressVorschlaege } from '../../useAdressVorschlaege';
import { adressAuswahlPatch } from '../../../lib/adresse';

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
  // Straße/PLZ/Stadt haben eigene Töpfe, die sich aber alle Adressfelder
  // mit demselben feld_typ teilen (z.B. Abhol- und Zieladresse).
  const basis = feldTypVon(field);
  const adressVorschlaege = useAdressVorschlaege();

  /**
   * Auswahl einer ganzen Adresse: verteilt Straße, PLZ und Ort auf die
   * drei Felder, überschreibt dabei aber NICHTS, was schon dasteht.
   */
  function adresseUebernehmen(a: { strasse: string; plz: string; ort: string }) {
    const p = adressAuswahlPatch({ strasse: v.strasse, plz: v.plz, stadt: v.stadt }, a);
    onChange({
      strasse: p.strasse ?? v.strasse ?? '',
      plz: p.plz ?? v.plz ?? '',
      stadt: p.stadt ?? v.stadt ?? '',
    });
  }
  return (
    <div>
      <label className="label">
        {field.label}{required && <span className="text-red-600"> *</span>}
      </label>
      {/* Manuell gepflegte Adressen — füllt alle drei Felder auf einmal,
          aber nur die noch leeren. */}
      {!disabled && (
        <AdressUebernehmen onWaehlen={adresseUebernehmen} />
      )}
      <div className="space-y-2">
        <SuggestCombobox
          feldTyp={basis ? adressTeilTyp(basis, 'strasse') : null}
          strukturVorschlaege={adressVorschlaege}
          onStruktur={adresseUebernehmen}
          placeholder="Straße + Hausnummer"
          aria-label={`${field.label} — Straße + Hausnummer`}
          value={v.strasse ?? ''}
          onChange={(next) => patch({ strasse: next })}
          disabled={disabled}
        />
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <SuggestCombobox
            feldTyp={basis ? adressTeilTyp(basis, 'plz') : null}
            placeholder="PLZ"
            aria-label={`${field.label} — PLZ`}
            value={v.plz ?? ''}
            onChange={(next) => patch({ plz: next })}
            disabled={disabled}
            inputMode="numeric"
          />
          <SuggestCombobox
            feldTyp={basis ? adressTeilTyp(basis, 'stadt') : null}
            placeholder="Stadt"
            aria-label={`${field.label} — Stadt`}
            value={v.stadt ?? ''}
            onChange={(next) => patch({ stadt: next })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
