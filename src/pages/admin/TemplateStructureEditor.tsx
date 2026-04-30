import { useEffect, useMemo, useState } from 'react';
import {
  getDamageDiagramSignedUrl, uploadDamageDiagramImage,
} from '../../lib/damageDiagramStorage';
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
  { value: 'dynamic_photos', label: 'Foto-Sammlung (dynamisch)' },
  { value: 'checkboxes_with_text', label: 'Mehrfachauswahl mit Textfeld' },
];

interface Props {
  templateId: string;
  schema: FormSchema;
  onChange: (next: FormSchema) => void;
}

export function TemplateStructureEditor({ templateId, schema, onChange }: Props) {
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
        // Stabiler Index-Key — sonst remountet React die Section bei jeder
        // Buchstabe in der ID, das Eingabefeld verliert Focus.
        <section key={sIdx} className="card space-y-3 p-5">
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
                  templateId={templateId}
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
  templateId, field, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  templateId: string;
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const needsOptions = field.type === 'select' || field.type === 'checkboxes' || field.type === 'checkboxes_with_text';
  const isDamageDiagram = field.type === 'damage_diagram';
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

      {isDamageDiagram && (
        <DamageImageUpload
          templateId={templateId}
          field={field}
          onChange={(path) => onChange({ vehicleImage: path })}
        />
      )}
    </div>
  );
}

function DamageImageUpload({
  templateId, field, onChange,
}: {
  templateId: string;
  field: FormField;
  onChange: (path: string | undefined) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = field.vehicleImage;

  useEffect(() => {
    let cancelled = false;
    if (!path) { setPreviewUrl(null); return; }
    getDamageDiagramSignedUrl(path).then((u) => { if (!cancelled) setPreviewUrl(u); });
    return () => { cancelled = true; };
  }, [path]);

  async function handleUpload(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Nur Bilddateien (PNG, JPG) werden akzeptiert.');
      return;
    }
    setUploading(true);
    try {
      const newPath = await uploadDamageDiagramImage(file, templateId, field.id);
      onChange(newPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-maja-navy/30 bg-white p-3">
      <div className="text-xs font-semibold text-maja-navy">Fahrzeugbild für Schadendiagramm</div>
      <p className="mb-2 text-xs text-maja-muted">
        Lade eine Skizze oder ein Foto des Fahrzeugs hoch. Beim Ausfüllen kann
        der Fahrer auf das Bild tippen, um Schäden zu markieren.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-maja-navy/15 bg-maja-light">
          {previewUrl ? (
            <img src={previewUrl} alt="Schadendiagramm" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-maja-muted">kein Bild</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="btn-secondary cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
            {uploading ? 'Hochladen …' : path ? 'Bild ersetzen' : 'Bild hochladen'}
          </label>
          {path && (
            <button
              type="button"
              className="text-xs font-medium text-red-600 hover:underline"
              onClick={() => onChange(undefined)}
            >
              Bild entfernen
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function uniqueId(base: string, existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}
