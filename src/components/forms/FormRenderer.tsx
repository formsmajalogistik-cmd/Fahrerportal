import { useEffect, useMemo, useState } from 'react';
import type { FormField, FormSchema, FormSection } from '../../types/db';
import { ErrorBoundary } from '../ErrorBoundary';
import { TextField } from './fields/TextField';
import { NumberField } from './fields/NumberField';
import { DateField } from './fields/DateField';
import { SelectField } from './fields/SelectField';
import { CheckboxesField } from './fields/CheckboxesField';
import { CheckboxesWithTextField } from './fields/CheckboxesWithTextField';
import { TextareaField } from './fields/TextareaField';
import { PhotoField } from './fields/PhotoField';
import { SignatureField } from './fields/SignatureField';
import { DamageDiagramField } from './fields/DamageDiagramField';
import { DynamicPhotosField } from './fields/DynamicPhotosField';
import { AddressField } from './fields/AddressField';

interface Props {
  schema: FormSchema;
  data: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  disabled?: boolean;
  /** OneDrive-Ordner des Formulars — Photos landen unter <folder>/Fotos/ */
  oneDriveFolder: string;
  /** ID der Formular-Instanz (ausgefuellte_formulare.id) — Photo-Felder
   *  brauchen sie für die Upload-Queue. */
  formularId?: string;
  /** Optional: nur diese Sections rendern (für Seitenfilterung). */
  sections?: FormSection[];
}

export function FormRenderer({ schema, data, onChange, disabled, oneDriveFolder, formularId, sections }: Props) {
  const visible = sections ?? schema.sections ?? [];

  // Aufgabe 4: Erstes dynamic_photos-Feld im Schema bestimmen — dort
  // landen automatisch Schaden-Fotos, wenn das Schadensdiagramm einen
  // neuen Punkt setzt.
  const firstDynamicPhotosField = useMemo(() => {
    for (const sec of schema.sections ?? []) {
      for (const f of sec.fields ?? []) {
        if (f?.type === 'dynamic_photos') return f;
      }
    }
    return null;
  }, [schema]);

  // Wenn das Diagramm meldet, dass neue Punkte gesetzt wurden, fragen
  // wir kurz nach, ob jetzt ein Foto vom Schaden gemacht werden soll.
  const [photoPrompt, setPhotoPrompt] = useState<{ count: number } | null>(null);
  useEffect(() => {
    if (disabled || !firstDynamicPhotosField) return;
    function onAdded(ev: Event) {
      const detail = (ev as CustomEvent<{ count: number }>).detail;
      if (!detail || detail.count <= 0) return;
      setPhotoPrompt({ count: detail.count });
    }
    window.addEventListener('maja:damage-points-added', onAdded);
    return () => window.removeEventListener('maja:damage-points-added', onAdded);
  }, [disabled, firstDynamicPhotosField]);

  function triggerInput(suffix: 'camera' | 'gallery') {
    if (!firstDynamicPhotosField) return;
    const el = document.getElementById(
      `dynphotos-${firstDynamicPhotosField.id}-${suffix}`,
    ) as HTMLInputElement | null;
    if (el) el.click();
    setPhotoPrompt(null);
  }
  function scrollToDynamicPhotos() {
    if (!firstDynamicPhotosField) return;
    const labelTarget = document.getElementById(`dynphotos-${firstDynamicPhotosField.id}-camera`);
    // Das hidden-Input liegt direkt neben den sichtbaren Buttons —
    // wir scrollen den Eltern-Container in den Viewport.
    labelTarget?.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="space-y-6">
      {visible.map((section) => {
        // Aufeinanderfolgende Photo-Felder werden zu einer Gruppe gebündelt
        // und gemeinsam in einem 2-Spalten-Grid gerendert. Alle anderen
        // Feldtypen bleiben einspaltig.
        const groups: Array<{ kind: 'photos' | 'other'; fields: FormField[] }> = [];
        for (const f of section.fields ?? []) {
          if (!f || typeof f !== 'object' || !f.id || !f.type) continue;
          const kind = f.type === 'photo' ? 'photos' : 'other';
          const last = groups[groups.length - 1];
          if (last && last.kind === kind) last.fields.push(f);
          else groups.push({ kind, fields: [f] });
        }
        return (
          <section key={section.id} className="card p-6">
            <h2 className="mb-4 text-lg font-semibold text-maja-navy">{section.title}</h2>
            <div className="space-y-5">
              {groups.map((g, gi) => g.kind === 'photos' ? (
                <div key={gi} className="grid grid-cols-2 items-start gap-3">
                  {g.fields.map((field) => (
                    <FieldErrorWrapper key={field.id} field={field}>
                      <FieldSwitch
                        field={field}
                        value={data[field.id]}
                        onChange={(v) => onChange(field.id, v)}
                        disabled={disabled}
                        oneDriveFolder={oneDriveFolder}
                        formularId={formularId}
                      />
                    </FieldErrorWrapper>
                  ))}
                </div>
              ) : (
                g.fields.map((field) => (
                  <FieldErrorWrapper key={field.id} field={field}>
                    <FieldSwitch
                      field={field}
                      value={data[field.id]}
                      onChange={(v) => onChange(field.id, v)}
                      disabled={disabled}
                      oneDriveFolder={oneDriveFolder}
                    />
                  </FieldErrorWrapper>
                ))
              ))}
            </div>
          </section>
        );
      })}

      {photoPrompt && firstDynamicPhotosField && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-maja-ink/40 px-4 pb-6 pt-12 sm:items-center">
          <div className="card w-full max-w-sm p-5">
            <h3 className="text-base font-semibold text-maja-navy">
              {photoPrompt.count === 1
                ? 'Foto vom Schaden aufnehmen?'
                : `${photoPrompt.count} neue Schäden — Fotos aufnehmen?`}
            </h3>
            <p className="mt-1 text-xs text-maja-muted">
              Die Aufnahme wird automatisch zum Foto-Feld
              „{firstDynamicPhotosField.label}" hinzugefügt.
            </p>
            <div className="mt-4 grid gap-2">
              <button type="button"
                      className="btn-primary"
                      onClick={() => triggerInput('camera')}>
                Foto aufnehmen
              </button>
              <button type="button"
                      className="btn-secondary"
                      onClick={() => triggerInput('gallery')}>
                Aus Galerie wählen
              </button>
              <button type="button"
                      className="text-xs text-maja-muted hover:underline"
                      onClick={() => { scrollToDynamicPhotos(); setPhotoPrompt(null); }}>
                Überspringen — Punkt(e) ohne Foto belassen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldErrorWrapper({ field, children }: { field: FormField; children: React.ReactNode }) {
  const showPrefillHint = field.prefill?.enabled && !field.prefill?.editable;
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-medium">
            Feld „{field.label}" konnte nicht gerendert werden
          </div>
          <div className="mt-1 text-xs">{error.message}</div>
          <button onClick={reset}
                  className="mt-2 text-xs font-medium text-maja-accent hover:underline">
            Erneut versuchen
          </button>
        </div>
      )}
    >
      <div className="relative">
        {children}
        {showPrefillHint && (
          <span className="pointer-events-none absolute right-2 top-0 -translate-y-2 rounded bg-maja-light px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-maja-muted dark:bg-slate-700 dark:text-slate-300">
            vorgegeben
          </span>
        )}
      </div>
    </ErrorBoundary>
  );
}

interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  oneDriveFolder: string;
  formularId?: string;
}

function FieldSwitch({ field, value, onChange, disabled, oneDriveFolder, formularId }: FieldProps) {
  // Read-only-Prefill: Wenn das Feld als „vorausfüllbar" markiert ist und
  // der Fahrer es NICHT ändern darf, wird es zusätzlich zum form-level
  // disabled gesperrt.
  const effDisabled = disabled
    || (field.prefill?.enabled === true && field.prefill?.editable !== true);
  switch (field.type) {
    case 'text':
      return <TextField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'date':
      return <DateField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'select':
      return <SelectField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'checkboxes':
      return <CheckboxesField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'checkboxes_with_text':
      return <CheckboxesWithTextField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'textarea':
      return <TextareaField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'photo':
      return (
        <PhotoField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={effDisabled}
        />
      );
    case 'signature':
      return <SignatureField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'damage_diagram':
      return <DamageDiagramField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'dynamic_photos':
      return (
        <DynamicPhotosField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={effDisabled}
        />
      );
    case 'address':
      return <AddressField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    default:
      return (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Unbekannter Feldtyp: <code>{(field as FormField).type}</code>
        </div>
      );
  }
}
