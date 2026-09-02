import { useEffect, useMemo, useState } from 'react';
import {
  getDamageDiagramSignedUrl, uploadDamageDiagramImage,
} from '../../lib/damageDiagramStorage';
import { makePageId } from '../../lib/formPages';
import type {
  FieldType, FormField, FormPage, FormSchema, FormSection,
} from '../../types/db';

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
  { value: 'address',        label: 'Adresse (Straße / PLZ / Stadt)' },
  { value: 'stamp',          label: 'Stempel (mit Auto-Freistellung)' },
];

/** Feldtypen, für die Vorschläge angeboten werden dürfen (Migration 077). */
const VORSCHLAG_TYPEN: FieldType[] = ['text', 'address'];

/**
 * Die einzigen Töpfe, die es noch gibt. Vorschläge sind ausschließlich
 * eine Adress-Funktion — Kennzeichen, Modelle, E-Mails und Namen werden
 * weder gesammelt noch angeboten.
 */
const FELD_TYP_VORSCHLAEGE = ['adresse', 'adresse_strasse', 'adresse_plz', 'adresse_stadt'];

/**
 * Erster Vorschlag für den Topf beim Aktivieren: aus Label/ID geraten,
 * damit gleichartige Felder automatisch im selben Topf landen. Passt
 * nichts, bleibt der Topf leer und die Ableitung entscheidet.
 */
function rateFeldTyp(field: FormField): string {
  const s = `${field.id} ${field.label}`.toLowerCase();
  if (field.type === 'address') return 'adresse';
  if (/(^|[^a-z])plz([^a-z]|$)|postleitzahl/.test(s)) return 'adresse_plz';
  if (/adresse|straße|strasse|anschrift/.test(s)) return 'adresse_strasse';
  if (/(^|[^a-z])ort([^a-z]|$)|stadt|standort/.test(s)) return 'adresse_stadt';
  return '';
}

/** Nur Adressfelder dürfen überhaupt in den Pool. */
function kannVorschlaege(field: FormField): boolean {
  if (!VORSCHLAG_TYPEN.includes(field.type)) return false;
  if (field.type === 'address') return true;
  return !!rateFeldTyp(field);
}

interface Props {
  templateId: string;
  schema: FormSchema;
  onChange: (next: FormSchema) => void;
  /** Wird aufgerufen, wenn die ID eines bestehenden Felds geändert wird. Der
   *  Parent kann damit die PDF-Mappings auf die neue ID umschreiben. */
  onFieldRename?: (oldId: string, newId: string) => void;
}

export function TemplateStructureEditor({ templateId, schema, onChange, onFieldRename }: Props) {
  const sections = schema.sections ?? [];
  const pages = schema.pages ?? [];

  function updateSections(next: FormSection[]) {
    onChange({ ...schema, sections: next });
  }

  function updatePages(next: FormPage[]) {
    onChange({ ...schema, pages: next });
  }

  function addPage() {
    const id = makePageId(`Seite ${pages.length + 1}`, pages.map((p) => p.id));
    updatePages([...pages, { id, title: `Seite ${pages.length + 1}`, sectionIds: [] }]);
  }

  function updatePage(idx: number, patch: Partial<FormPage>) {
    updatePages(pages.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function removePage(idx: number) {
    if (!confirm('Seite löschen? Sections bleiben erhalten und werden auf die erste Seite verschoben.')) return;
    const removed = pages[idx];
    const remaining = pages.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      updatePages([]);
      return;
    }
    // Zuordnung an erste verbleibende Seite verschieben
    remaining[0] = {
      ...remaining[0],
      sectionIds: [...remaining[0].sectionIds, ...(removed.sectionIds ?? [])],
    };
    updatePages(remaining);
  }

  function movePage(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[idx], next[target]] = [next[target], next[idx]];
    updatePages(next);
  }

  /**
   * Ordnet eine Section einer Seite zu (oder nimmt sie aus allen Seiten,
   * wenn pageId leer ist). Sections, die keiner Seite zugeordnet sind,
   * landen automatisch auf der letzten Seite (siehe lib/formPages.ts).
   */
  function setSectionPage(sectionId: string, pageId: string) {
    if (pages.length === 0) return;
    const next = pages.map((p) => ({
      ...p,
      sectionIds: p.sectionIds.filter((sid) => sid !== sectionId),
    }));
    if (pageId) {
      const idx = next.findIndex((p) => p.id === pageId);
      if (idx >= 0) next[idx] = { ...next[idx], sectionIds: [...next[idx].sectionIds, sectionId] };
    }
    updatePages(next);
  }

  function pageOfSection(sectionId: string): string {
    for (const p of pages) if (p.sectionIds.includes(sectionId)) return p.id;
    // Implizite letzte Seite (siehe effectivePages-Heuristik)
    return pages[pages.length - 1]?.id ?? '';
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
    const oldField = section.fields[fIdx];
    const nextFields = section.fields.map((f, i) => (i === fIdx ? { ...f, ...patch } : f));
    // Wenn die Feld-ID geändert wurde, das zugehörige PDF-Mapping
    // automatisch mitziehen — sonst wird der bestehende Marker zu einem
    // Orphan, der weder verschoben noch gelöscht werden kann.
    if (typeof patch.id === 'string' && patch.id !== oldField.id && oldField.id) {
      onFieldRename?.(oldField.id, patch.id);
    }
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
      <div className="card p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-maja-navy">Seiten</h3>
            <p className="text-xs text-maja-muted">
              Optional. Wenn keine Seiten definiert sind, sieht der Fahrer alle
              Sektionen am Stück. Mit Seiten kann das Formular in Tabs aufgeteilt werden.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={addPage}>
            + Seite hinzufügen
          </button>
        </div>
        {pages.length === 0 ? (
          <p className="text-xs text-maja-muted">Noch keine Seiten — Formular wird einseitig dargestellt.</p>
        ) : (
          <ul className="space-y-2">
            {pages.map((p, pIdx) => (
              <li key={pIdx} className="flex flex-wrap items-end gap-2 rounded-lg border border-maja-navy/15 bg-white p-3">
                <div className="flex-1 min-w-[180px]">
                  <label className="label">Seitentitel</label>
                  <input
                    className="input"
                    value={p.title}
                    onChange={(e) => updatePage(pIdx, { title: e.target.value })}
                  />
                </div>
                <div className="w-40">
                  <label className="label">ID</label>
                  <input
                    className="input font-mono text-xs"
                    value={p.id}
                    onChange={(e) => updatePage(pIdx, { id: e.target.value.trim() })}
                  />
                </div>
                <div className="text-xs text-maja-muted">
                  {p.sectionIds.length} Section{p.sectionIds.length === 1 ? '' : 's'}
                </div>
                <div className="ml-auto flex gap-1">
                  <button type="button" onClick={() => movePage(pIdx, -1)}
                          className="btn-secondary px-2 py-1 text-xs">↑</button>
                  <button type="button" onClick={() => movePage(pIdx, 1)}
                          className="btn-secondary px-2 py-1 text-xs">↓</button>
                  <button type="button" onClick={() => removePage(pIdx)}
                          className="text-xs font-medium text-red-600 hover:underline">
                    entfernen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
            {pages.length > 0 && (
              <div className="w-44">
                <label className="label">Seite</label>
                <select
                  className="input"
                  value={pageOfSection(section.id)}
                  onChange={(e) => setSectionPage(section.id, e.target.value)}
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
            )}
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
            onChange={(e) => {
              const type = e.target.value as FieldType;
              // Sinnvolle Vorbelegung: Adressfelder bekommen Vorschläge
              // automatisch, Typen ohne Vorschlags-Support verlieren die
              // Einstellung wieder.
              if (!VORSCHLAG_TYPEN.includes(type)) {
                onChange({ type, vorschlaege: undefined });
              } else if (type === 'address' && !field.vorschlaege) {
                onChange({ type, vorschlaege: { enabled: true, feld_typ: 'adresse' } });
              } else {
                onChange({ type });
              }
            }}
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

        {/* Datumsfelder können optional auf "nur Datum" gestellt werden —
            default ist "mit Uhrzeit + Jetzt-Button" (Aufgabe 2). */}
        {field.type === 'date' && (
          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
              checked={field.includeTime !== false}
              onChange={(e) => onChange({ includeTime: e.target.checked })}
            />
            Mit Uhrzeit + „Jetzt"
          </label>
        )}

        <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={!!field.prefill?.enabled}
            onChange={(e) => onChange({
              prefill: e.target.checked
                ? { enabled: true, editable: field.prefill?.editable ?? false }
                : undefined,
            })}
          />
          Vorausfüllbar
        </label>

        {field.prefill?.enabled && (
          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
              checked={!!field.prefill?.editable}
              onChange={(e) => onChange({
                prefill: { enabled: true, editable: e.target.checked },
              })}
            />
            Vom Fahrer änderbar
          </label>
        )}

        {/* Vorschläge gibt es nur noch für ADRESSFELDER — Straße, PLZ
            und Ort. Alles andere (Kennzeichen, Modelle, Namen, Freitext,
            Kilometerstand) wandert weder in den Pool noch bekommt es ein
            Dropdown. */}
        {kannVorschlaege(field) && (
          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
              checked={!!field.vorschlaege?.enabled}
              onChange={(e) => onChange({
                vorschlaege: e.target.checked
                  ? {
                      enabled: true,
                      feld_typ: field.vorschlaege?.feld_typ || rateFeldTyp(field),
                    }
                  : undefined,
              })}
            />
            Vorschläge aktivieren
          </label>
        )}

        {kannVorschlaege(field) && field.vorschlaege?.enabled && (
          <div className="min-w-[220px]">
            <label className="label">Vorschlags-Topf</label>
            <input
              className="input font-mono text-xs"
              list={`feldtyp-optionen-${field.id}`}
              value={field.vorschlaege.feld_typ ?? ''}
              placeholder={field.id}
              onChange={(e) => onChange({
                vorschlaege: { enabled: true, feld_typ: e.target.value.trim() },
              })}
            />
            <datalist id={`feldtyp-optionen-${field.id}`}>
              {FELD_TYP_VORSCHLAEGE.map((t) => <option key={t} value={t} />)}
            </datalist>
            <p className="mt-1 text-xs text-maja-muted">
              Felder mit demselben Topf teilen sich die Vorschläge — z.B.
              alle Adressfelder. Nur Adress-Töpfe sind zulässig; leer =
              automatisch aus Feldname und Beschriftung abgeleitet.
            </p>
          </div>
        )}

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
