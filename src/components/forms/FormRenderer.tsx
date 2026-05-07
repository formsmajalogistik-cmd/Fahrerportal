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
  /** Optional: nur diese Sections rendern (für Seitenfilterung). */
  sections?: FormSection[];
}

export function FormRenderer({ schema, data, onChange, disabled, oneDriveFolder, sections }: Props) {
  const visible = sections ?? schema.sections ?? [];
  return (
    <div className="space-y-6">
      {visible.map((section) => (
        <section key={section.id} className="card p-6">
          <h2 className="mb-4 text-lg font-semibold text-maja-navy">{section.title}</h2>
          <div className="space-y-5">
            {(section.fields ?? []).map((field) => {
              if (!field || typeof field !== 'object' || !field.id || !field.type) {
                console.warn('[FormRenderer] Ungültiges Feld übersprungen:', field);
                return null;
              }
              return (
                <ErrorBoundary
                  key={field.id}
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
                  <FieldSwitch
                    field={field}
                    value={data[field.id]}
                    onChange={(v) => onChange(field.id, v)}
                    disabled={disabled}
                    oneDriveFolder={oneDriveFolder}
                  />
                </ErrorBoundary>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  oneDriveFolder: string;
}

function FieldSwitch({ field, value, onChange, disabled, oneDriveFolder }: FieldProps) {
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
