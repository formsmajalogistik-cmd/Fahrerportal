// Vorausfüllungs-Dialog für Tour-Protokolle.
//
// Wird in ProtokollSection geöffnet, sobald ein „schriftliches Protokoll"
// (Template) gewählt wird, dessen Schema mindestens ein Feld mit
// prefill.enabled=true enthält. Der Admin trägt die Werte ein; sie landen
// in touren.vorgefuellte_daten und werden beim Öffnen des Formulars in den
// Initial-State des Fahrers gemergt.
//
// Bestehende Werte werden zum Bearbeiten („Vorgaben bearbeiten") wieder
// in die Inputs geladen.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import type {
  FieldType, FormField, FormSchema, FormularTemplate,
} from '../../types/db';
import type { Json } from '../../types/supabase';

interface Props {
  tourId: string;
  template: Pick<FormularTemplate, 'id' | 'name' | 'schema'>;
  /** Bisher gespeicherte Vorgaben (touren.vorgefuellte_daten). */
  initial: Record<string, unknown>;
  onClose: () => void;
  onSaved: (next: Record<string, unknown>) => void;
}

export function collectPrefillableFields(schema: FormSchema | null | undefined): FormField[] {
  if (!schema || !Array.isArray(schema.sections)) return [];
  const out: FormField[] = [];
  for (const s of schema.sections) {
    for (const f of s.fields ?? []) {
      if (f?.prefill?.enabled) out.push(f);
    }
  }
  return out;
}

export function PrefillDialog({ tourId, template, initial, onClose, onSaved }: Props) {
  const fields = useMemo(() => collectPrefillableFields(template.schema), [template.schema]);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // initial neu aufziehen, wenn sich der Dialog wieder öffnet.
  useEffect(() => {
    void Promise.resolve().then(() => setValues({ ...initial }));
  }, [initial]);

  function setField(id: string, v: unknown) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }

  async function save(nextDaten: Record<string, unknown> | null) {
    setBusy(true);
    setError(null);
    const payload = nextDaten as unknown as Json | null;
    const { error: err } = await supabase
      .from('touren')
      .update({ vorgefuellte_daten: payload })
      .eq('id', tourId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(nextDaten ?? {});
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">
              Daten für {template.name} vorab eingeben
            </h2>
            <p className="mt-0.5 text-xs text-maja-muted">
              Diese Felder erscheinen beim Fahrer bereits vorausgefüllt.
              Felder, die nicht vom Fahrer änderbar sind, werden read-only
              angezeigt.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-maja-muted">
            Dieses Template hat keine als „vorausfüllbar" markierten Felder.
          </p>
        ) : (
          <div className="space-y-4">
            {fields.map((f) => (
              <PrefillFieldRow
                key={f.id}
                field={f}
                value={values[f.id]}
                onChange={(v) => setField(f.id, v)}
              />
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void save(null)}
            className="btn-secondary"
            disabled={busy}
            title="Vorausfüllung entfernen — Formular ist beim Fahrer leer."
          >
            Überspringen
          </button>
          <button
            type="button"
            onClick={() => void save(values)}
            className="btn-primary"
            disabled={busy || fields.length === 0}
          >
            {busy ? 'Speichern …' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefillFieldRow({
  field, value, onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="rounded-lg border border-maja-navy/15 bg-maja-light/30 p-3 dark:bg-surface-700/40">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <label htmlFor={`prefill-${field.id}`} className="text-sm font-medium text-maja-ink">
          {field.label}
        </label>
        <span className="text-[11px] text-maja-muted">
          {field.prefill?.editable ? 'vom Fahrer änderbar' : 'read-only beim Fahrer'}
        </span>
      </div>
      <PrefillInput field={field} value={value} onChange={onChange} />
    </div>
  );
}

function PrefillInput({
  field, value, onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `prefill-${field.id}`;
  switch (field.type as FieldType) {
    case 'text':
    case 'number':
    case 'date':
      return (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          className="input"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      );
    case 'textarea':
      return (
        <textarea
          id={id}
          className="input min-h-[80px]"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      );
    case 'select':
      return (
        <select
          id={id}
          className="input"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— bitte wählen —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case 'address': {
      const v = (typeof value === 'object' && value)
        ? value as Record<string, unknown>
        : {};
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Straße"
                 value={asString(v.strasse)}
                 onChange={(e) => onChange({ ...v, strasse: e.target.value })} />
          <input className="input" placeholder="PLZ"
                 value={asString(v.plz)}
                 onChange={(e) => onChange({ ...v, plz: e.target.value })} />
          <input className="input sm:col-span-2" placeholder="Stadt"
                 value={asString(v.stadt)}
                 onChange={(e) => onChange({ ...v, stadt: e.target.value })} />
        </div>
      );
    }
    default:
      // Andere Feldtypen (Photo, Signature, Damage, Dynamic Photos, Checkboxes …)
      // werden hier als reines Text-Input gespeichert. Für die meisten dieser
      // Typen ergibt eine Vorausfüllung wenig Sinn — der Admin sollte sie im
      // Template-Editor gar nicht erst als „vorausfüllbar" markieren.
      return (
        <input
          id={id}
          type="text"
          className="input"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Feldtyp ${field.type} — Freitext-Vorgabe`}
        />
      );
  }
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}
