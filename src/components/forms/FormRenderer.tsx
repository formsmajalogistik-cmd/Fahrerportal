import type { FormField, FormSchema } from '../../types/db';
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

interface Props {
  schema: FormSchema;
  data: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  disabled?: boolean;
  userId: string;
  formularId: string;
}

export function FormRenderer({ schema, data, onChange, disabled, userId, formularId }: Props) {
  return (
    <div className="space-y-6">
      {(schema.sections ?? []).map((section) => (
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
                    userId={userId}
                    formularId={formularId}
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
  userId: string;
  formularId: string;
}

function FieldSwitch({ field, value, onChange, disabled, userId, formularId }: FieldProps) {
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
          userId={userId} formularId={formularId}
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
          userId={userId} formularId={formularId}
          onChange={onChange} disabled={disabled}
        />
      );
    default:
      return (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Unbekannter Feldtyp: <code>{(field as FormField).type}</code>
        </div>
      );
  }
}
