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
    </div>
  );
}

function FieldErrorWrapper({ field, children }: { field: FormField; children: React.ReactNode }) {
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
      {children}
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
  switch (field.type) {
    case 'text':
      return <TextField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'date':
      return <DateField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'select':
      return <SelectField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'checkboxes':
      return <CheckboxesField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'checkboxes_with_text':
      return <CheckboxesWithTextField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'textarea':
      return <TextareaField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'photo':
      return (
        <PhotoField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={disabled}
        />
      );
    case 'signature':
      return <SignatureField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'damage_diagram':
      return <DamageDiagramField field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'dynamic_photos':
      return (
        <DynamicPhotosField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          onChange={onChange} disabled={disabled}
        />
      );
    case 'address':
      return <AddressField field={field} value={value} onChange={onChange} disabled={disabled} />;
    default:
      return (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Unbekannter Feldtyp: <code>{(field as FormField).type}</code>
        </div>
      );
  }
}
