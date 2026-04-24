import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildPreviewPdf } from '../../lib/pdfPreview';
import { fetchPdfBytes, getPdfSignedUrl, uploadPdfTemplate } from '../../lib/pdfStorage';
import { PdfMappingCanvas } from '../../components/forms/PdfMappingCanvas';
import type { FieldMapping, FieldMappingEntry, FormField, FormSchema } from '../../types/db';

interface Props {
  templateId: string;
  schema: FormSchema;
  mapping: FieldMapping;
  pdfTemplate: string | null;
  onMappingChange: (next: FieldMapping) => void;
  onPdfTemplateChange: (path: string) => void;
}

const PHOTO_DEFAULT_WIDTH = 200;
const PHOTO_DEFAULT_HEIGHT = 150;

export function TemplateMappingEditor({
  templateId, schema, mapping, pdfTemplate,
  onMappingChange, onPdfTemplateChange,
}: Props) {
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number; page: number } | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);

  const fields = useMemo(() => {
    const out: FormField[] = [];
    for (const s of schema.sections ?? []) for (const f of s.fields ?? []) out.push(f);
    return out;
  }, [schema]);

  const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  useEffect(() => {
    let cancelled = false;
    if (!pdfTemplate) { setPdfBytes(null); return; }
    (async () => {
      const bytes = await fetchPdfBytes(pdfTemplate);
      if (!cancelled) setPdfBytes(bytes);
    })();
    return () => { cancelled = true; };
  }, [pdfTemplate]);

  const onPageCount = useCallback((n: number) => { setPageCount(n); }, []);

  async function handleUpload(file: File) {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Nur PDF-Dateien werden akzeptiert.');
      return;
    }
    setUploading(true);
    try {
      const path = await uploadPdfTemplate(file, templateId);
      onPdfTemplateChange(path);
      const buf = await file.arrayBuffer();
      setPdfBytes(buf);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  function assignField(fieldId: string) {
    if (!pending) return;
    const field = fieldsById.get(fieldId);
    const isPhoto = field?.type === 'photo';
    const entry: FieldMappingEntry = {
      page: pending.page,
      x: Math.round(pending.x),
      y: Math.round(pending.y),
      ...(isPhoto ? { width: PHOTO_DEFAULT_WIDTH, height: PHOTO_DEFAULT_HEIGHT } : {}),
    };
    onMappingChange({ ...mapping, [fieldId]: entry });
    setPending(null);
    setSelectedField(fieldId);
  }

  function updateEntry(fieldId: string, patch: Partial<FieldMappingEntry>) {
    const current = mapping[fieldId];
    if (!current) return;
    onMappingChange({ ...mapping, [fieldId]: { ...current, ...patch } });
  }

  function removeEntry(fieldId: string) {
    const { [fieldId]: _remove, ...rest } = mapping;
    onMappingChange(rest);
    if (selectedField === fieldId) setSelectedField(null);
  }

  async function openPreview() {
    if (!pdfBytes) return;
    setBusyPreview(true);
    try {
      const blob = await buildPreviewPdf(pdfBytes.slice(0), schema, mapping);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorschau fehlgeschlagen');
    } finally {
      setBusyPreview(false);
    }
  }

  async function openOriginal() {
    if (!pdfTemplate) return;
    const url = await getPdfSignedUrl(pdfTemplate);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-maja-navy">PDF-Vorlage</h3>
            <p className="text-xs text-maja-muted">
              {pdfTemplate
                ? <>aktuell: <code className="rounded bg-maja-light px-1">{pdfTemplate}</code></>
                : 'Noch keine PDF-Vorlage hochgeladen.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = '';
                }}
              />
              {uploading ? 'Wird hochgeladen …' : pdfTemplate ? 'PDF ersetzen' : 'PDF hochladen'}
            </label>
            {pdfTemplate && (
              <button type="button" onClick={openOriginal} className="btn-secondary">
                Original öffnen
              </button>
            )}
            <button
              type="button"
              onClick={openPreview}
              className="btn-primary"
              disabled={!pdfBytes || busyPreview}
            >
              {busyPreview ? 'Vorschau …' : 'Vorschau generieren'}
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {pdfBytes && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-maja-muted">
                Seite
                <select
                  className="input mx-2 inline-block w-20"
                  value={page}
                  onChange={(e) => setPage(Number(e.target.value))}
                >
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                von {pageCount}
              </div>
              <p className="text-xs text-maja-muted">
                Klick ins PDF, um ein Feld zu positionieren. Klick auf einen Marker zum Auswählen.
              </p>
            </div>
            <PdfMappingCanvas
              pdfBytes={pdfBytes}
              page={page}
              onPageCount={onPageCount}
              mapping={mapping}
              onClick={(c) => setPending(c)}
              onMarkerClick={(id) => setSelectedField(id)}
              selectedFieldId={selectedField}
            />
          </div>

          <aside className="space-y-4">
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-maja-navy">Gemappte Felder</h3>
              {Object.keys(mapping).length === 0 ? (
                <p className="text-xs text-maja-muted">Noch keine Zuordnungen.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {Object.entries(mapping).map(([fid, entry]) => {
                    const field = fieldsById.get(fid);
                    return (
                      <li key={fid}
                          className={
                            'rounded-md px-2 py-1 cursor-pointer ' +
                            (selectedField === fid ? 'bg-maja-accent/20' : 'hover:bg-maja-light')
                          }
                          onClick={() => { setSelectedField(fid); setPage(entry.page); }}>
                        <div className="flex items-center justify-between">
                          <span className="truncate">
                            <span className="font-medium text-maja-ink">
                              {field?.label ?? fid}
                            </span>
                            {' '}
                            <span className="text-xs text-maja-muted">
                              (S. {entry.page})
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeEntry(fid); }}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >×</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selectedField && mapping[selectedField] && (
              <EntryDetails
                fieldId={selectedField}
                field={fieldsById.get(selectedField) ?? null}
                entry={mapping[selectedField]}
                onChange={(patch) => updateEntry(selectedField, patch)}
                onRemove={() => removeEntry(selectedField)}
              />
            )}
          </aside>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-1 text-lg font-semibold text-maja-navy">
              Feld positionieren
            </h2>
            <p className="mb-4 text-xs text-maja-muted">
              Position: Seite {pending.page}, x={Math.round(pending.x)} pt,
              y={Math.round(pending.y)} pt.
              Welches Feld soll hier platziert werden?
            </p>
            <div className="max-h-72 space-y-1 overflow-auto">
              {fields.length === 0 && (
                <p className="text-sm text-maja-muted">Es gibt noch keine Felder.</p>
              )}
              {fields.map((f) => {
                const already = !!mapping[f.id];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => assignField(f.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-maja-navy/15 bg-white px-3 py-2 text-left text-sm hover:bg-maja-light"
                  >
                    <span>
                      <span className="font-medium text-maja-ink">{f.label}</span>
                      {' '}
                      <span className="text-xs text-maja-muted">({f.type})</span>
                    </span>
                    {already && <span className="text-xs text-amber-700">bereits gemappt</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setPending(null)} className="btn-secondary">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryDetails({
  fieldId, field, entry, onChange, onRemove,
}: {
  fieldId: string;
  field: FormField | null;
  entry: FieldMappingEntry;
  onChange: (patch: Partial<FieldMappingEntry>) => void;
  onRemove: () => void;
}) {
  const isPhoto = field?.type === 'photo';

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-maja-navy">
          {field?.label ?? fieldId}
        </h3>
        <button type="button" onClick={onRemove}
                className="text-xs font-medium text-red-600 hover:underline">
          entfernen
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <NumberCell label="Seite" value={entry.page} onChange={(v) => onChange({ page: v })} min={1} />
        <NumberCell label="Schriftgröße" value={entry.fontSize ?? 10}
                    onChange={(v) => onChange({ fontSize: v })} min={4} />
        <NumberCell label="X (pt)" value={entry.x} onChange={(v) => onChange({ x: v })} />
        <NumberCell label="Y (pt)" value={entry.y} onChange={(v) => onChange({ y: v })} />
        {isPhoto && (
          <>
            <NumberCell label="Breite (pt)" value={entry.width ?? PHOTO_DEFAULT_WIDTH}
                        onChange={(v) => onChange({ width: v })} min={10} />
            <NumberCell label="Höhe (pt)" value={entry.height ?? PHOTO_DEFAULT_HEIGHT}
                        onChange={(v) => onChange({ height: v })} min={10} />
          </>
        )}
      </div>
    </div>
  );
}

function NumberCell({
  label, value, onChange, min,
}: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
