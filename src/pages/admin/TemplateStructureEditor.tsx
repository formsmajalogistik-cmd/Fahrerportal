import { useMemo } from 'react';
import type { FieldType, FormField, FormSchema, FormSection } from '../../types/db';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',           label: 'Text' },
  { value: 'number',         label: 'Zahl' },
  { value: 'date',           label: 'Datum' },
  { value: 'select',         label: 'Auswahl (Dropdown)' },
  { value: 'checkboxes',     label: 'Mehrfachauswahl' },
  { value: 'textarea',       label: 'Mehrzeiliger Text' },
  { value: 'photo',          label: 'Foto' },
  { value: 'signature',      label: 'Unterschrift' },
  { value: 'damage_diagram', label: 'Schadensdiagramm' },
];

interface Props {
  schema: FormSchema;
  onChange: (next: FormSchema) => void;
}

export function TemplateStructureEditor({ schema, onChange }: Props) {
  const sections = schema.sections ?? [];

  function updateSections(next: FormSection[]) {
    onChange({ ...schema, sections: next });
  }

  function addSection() {
    const id = uniqueId('section', sections.map((s) => s.id));
    updateSections([...sections, { id, title: 'Neue Sektion', fields: [] }]);
  }

  function updateSection(idx: number, patch: Partial<FormSection>) {
    const next = sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    updateSections(next);
  }

  function removeSection(idx: number) {
    updateSections(sections.filter((_, i) => i !== idx));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[idx], next[target]] = [next[target], next[idx]];
    updateSections(next);
  }

  function addField(sIdx: number) {
    const section = sections[sIdx];
    const allIds = sections.flatMap((s) => s.fields.map((f) => f.id));
    const id = uniqueId('feld', allIds);
    const field: FormField = { id, type: 'text', label: 'Neues Feld' };
    updateSection(sIdx, { fields: [...section.fields, field] });
  }

  function updateField(sIdx: number, fIdx: number, patch: Partial<FormField>) {
    const section = sections[sIdx];
    const nextFields = section.fields.map((f, i) => (i === fIdx ? { ...f, ...patch } : f));
    updateSection(sIdx, { fields: nextFields });
  }

  function removeField(sIdx: number, fIdx: number) {
    const section = sections[sIdx];
    updateSection(sIdx, { fields: section.fields.filter((_, i) => i !== fIdx) });
  }

  function moveField(sIdx: number, fIdx: number, dir: -1 | 1) {
    const section = sections[sIdx];
    const target = fIdx + dir;
    if (target < 0 || target >= section.fields.length) return;
    const next = [...section.fields];
    [next[fIdx], next[target]] = [next[target], next[fIdx]];
    updateSection(sIdx, { fields: next });
  }

  return (
    <div className="space-y-4">
      {sections.length === 0 && (
        <div className="card p-4 text-sm text-maja-muted">
          Noch keine Sektionen. Lege unten eine an.
        </div>
      )}

      {sections.map((section, sIdx) => (
        <section key={section.id} className="card space-y-3 p-5">
          <header className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Sektions-Titel</label>
              <input
                className="input"
                value={section.title}
                onChange={(e) => updateSection(sIdx, { title: e.target.value })}
              />
            </div>
            <div className="w-48">
              <label className="label">ID</label>
              <input
                className="input font-mono text-xs"
                value={section.id}
                onChange={(e) => updateSection(sIdx, { id: e.target.value.trim() })}
              />
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => moveSection(sIdx, -1)}
                      className="btn-secondary px-2 py-2" title="Nach oben">↑</button>
              <button type="button" onClick={() => moveSection(sIdx, 1)}
                      className="btn-secondary px-2 py-2" title="Nach unten">↓</button>
              <button type="button" onClick={() => removeSection(sIdx)}
                      className="text-sm font-medium text-red-600 hover:underline ml-2">
                Sektion löschen
              </button>
            </div>
          </header>

          <div className="space-y-2">
            {section.fields.length === 0 ? (
              <p className="text-xs text-maja-muted">Keine Felder in dieser Sektion.</p>
            ) : (
              section.fields.map((field, fIdx) => (
                <FieldEditor
                  key={fIdx}
                  field={field}
                  onChange={(patch) => updateField(sIdx, fIdx, patch)}
                  onRemove={() => removeField(sIdx, fIdx)}
                  onMoveUp={() => moveField(sIdx, fIdx, -1)}
                  onMoveDown={() => moveField(sIdx, fIdx, 1)}
                />
              ))
            )}
          </div>

          <div>
            <button type="button" onClick={() => addField(sIdx)} className="btn-secondary">
              + Feld hinzufügen
            </button>
          </div>
        </section>
      ))}

      <button type="button" onClick={addSection} className="btn-primary">
        + Sektion hinzufügen
      </button>
    </div>
  );
}

function FieldEditor({
  field, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const needsOptions = field.type === 'select' || field.type === 'checkboxes';
  const optionsText = useMemo(() => (field.options ?? []).join('\n'), [field.options]);

  return (
    <div className="rounded-lg border border-maja-navy/15 bg-maja-light/50 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_220px_auto]">
        <div>
          <label className="label">Label</label>
          <input
            className="input"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div>
          <label className="label">ID</label>
          <input
            className="input font-mono text-xs"
            value={field.id}
            onChange={(e) => onChange({ id: e.target.value.trim() })}
          />
        </div>
        <div>
          <label className="label">Typ</label>
          <select
            className="input"
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <button type="button" onClick={onMoveUp} className="btn-secondary px-2 py-1 text-xs">↑</button>
            <button type="button" onClick={onMoveDown} className="btn-secondary px-2 py-1 text-xs">↓</button>
          </div>
          <button type="button" onClick={onRemove}
                  className="text-xs font-medium text-red-600 hover:underline">
            entfernen
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={!!field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Pflichtfeld
        </label>

        {needsOptions && (
          <div className="flex-1 min-w-[240px]">
            <label className="label">Optionen (eine pro Zeile)</label>
            <textarea
              className="input min-h-[72px] font-mono text-xs"
              value={optionsText}
              onChange={(e) => onChange({
                options: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
              })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function uniqueId(base: string, existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}
