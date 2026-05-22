import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildPreviewPdf } from '../../lib/pdfPreview';
import { fetchPdfBytes, getPdfSignedUrl, uploadPdfTemplate } from '../../lib/pdfStorage';
import { PdfMappingCanvas } from '../../components/forms/PdfMappingCanvas';
import { CheckBoxEmptyIcon, CheckIcon } from '../../components/icons';
import {
  fieldsById,
  isBoxEntry, isCheckboxesWithTextEntry, isDynamicEntry, isFieldMappedOnPage,
  isOptionsEntry, isTextEntry,
  makeDefaultEntry, modeFor, OPTION_DEFAULT_SIZE,
  PHOTO_DEFAULT_HEIGHT, PHOTO_DEFAULT_WIDTH, removeOption,
  setOptionPart, setOptionPosition,
  TEXT_DEFAULT_FONT,
} from '../../lib/fieldMapping';
import type {
  BoxEntry, DynamicPhotosEntry, FieldMapping, FormField, FormSchema,
  OptionPosition, TextEntry,
} from '../../types/db';

interface Props {
  /** Template-ID für den Storage-Pfad (Bucket-Subordner). */
  templateId: string;
  /** Stable PDF-ID innerhalb des Templates (z.B. "protokoll", "fotos"). */
  pdfId: string;
  /** Anzeigename der aktiven PDF (für Texte im Editor). */
  pdfName: string;
  /** Schema des Templates (für Feldliste & Picker). */
  schema: FormSchema;
  /** Aktuelles Mapping dieser einen PDF. */
  mapping: FieldMapping;
  /** Storage-Pfad der aktiven PDF (oder null = noch nichts hochgeladen). */
  pdfPath: string | null;
  onMappingChange: (next: FieldMapping) => void;
  onPdfPathChange: (path: string) => void;
}

interface Selection {
  fieldId: string;
  optionName?: string;
  part?: 'checkbox' | 'text';
}

export function TemplateMappingEditor({
  templateId, pdfId, pdfName, schema, mapping, pdfPath,
  onMappingChange, onPdfPathChange,
}: Props) {
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number; page: number } | null>(null);
  const [pickerStep, setPickerStep] = useState<{ field: FormField } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);

  const fieldMap = useMemo(() => fieldsById(schema), [schema]);
  const fields = useMemo(() => Array.from(fieldMap.values()), [fieldMap]);
  const fieldLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of fields) {
      m[f.id] = f.label;
      if (f.type === 'address') {
        m[`${f.id}.strasse`] = `${f.label} – Straße`;
        m[`${f.id}.plz`]     = `${f.label} – PLZ`;
        m[`${f.id}.stadt`]   = `${f.label} – Stadt`;
      }
    }
    return m;
  }, [fields]);

  useEffect(() => {
    let cancelled = false;
    if (!pdfPath) { setPdfBytes(null); return; }
    (async () => {
      const bytes = await fetchPdfBytes(pdfPath);
      if (!cancelled) setPdfBytes(bytes);
    })();
    return () => { cancelled = true; };
  }, [pdfPath]);

  // Wenn die aktive PDF wechselt, Auswahl & Seite resetten.
  useEffect(() => {
    setSelected(null);
    setPending(null);
    setPickerStep(null);
    setPage(1);
  }, [pdfId]);

  const onPageCount = useCallback((n: number) => { setPageCount(n); }, []);

  async function handleUpload(file: File) {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Nur PDF-Dateien werden akzeptiert.');
      return;
    }
    setUploading(true);
    try {
      const path = await uploadPdfTemplate(file, templateId, pdfId);
      onPdfPathChange(path);
      setPdfBytes(await file.arrayBuffer());
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  // Stufe 1: Klick aufs PDF → Feld wählen
  function onCanvasClick(c: { x: number; y: number; page: number }) {
    setPending(c);
    setPickerStep(null);
  }

  // Stufe 2a: text/box-Feld direkt platzieren
  function placeSimpleField(field: FormField) {
    if (!pending) return;
    const entry = makeDefaultEntry(field, {
      x: Math.round(pending.x), y: Math.round(pending.y), page: pending.page,
    });
    onMappingChange({ ...mapping, [field.id]: entry });
    setSelected({ fieldId: field.id });
    setPending(null);
    setPickerStep(null);
  }

  // Stufe 2b: options-Feld → Option wählen
  function placeOption(field: FormField, optionName: string) {
    if (!pending) return;
    const pos: OptionPosition = {
      page: pending.page, x: Math.round(pending.x), y: Math.round(pending.y),
    };
    onMappingChange(setOptionPosition(mapping, field, optionName, pos));
    setSelected({ fieldId: field.id, optionName });
    setPending(null);
    setPickerStep(null);
  }

  // Stufe 2c: checkboxes_with_text — pro Option zwei Slots (Häkchen + Text)
  function placeOptionPart(field: FormField, optionName: string, part: 'checkbox' | 'text') {
    if (!pending) return;
    const pos = {
      page: pending.page, x: Math.round(pending.x), y: Math.round(pending.y),
    };
    onMappingChange(setOptionPart(mapping, field.id, optionName, part, pos));
    setSelected({ fieldId: field.id, optionName, part });
    setPending(null);
    setPickerStep(null);
  }

  function pickField(field: FormField) {
    const m = modeFor(field.type);
    if (m === 'options' || m === 'options_text') {
      setPickerStep({ field });
    } else {
      placeSimpleField(field);
    }
  }

  /**
   * Platziert einen TextEntry an einem zusammengesetzten Mapping-Schlüssel
   * (z.B. `adresse.strasse` oder `schaeden.beschreibung`). Wird für Sub-
   * Felder von `address` und für die Beschreibungs-Position bei
   * `damage_diagram` genutzt.
   */
  function placeTextAtKey(key: string) {
    if (!pending) return;
    const entry: TextEntry = {
      type: 'text',
      page: pending.page,
      x: Math.round(pending.x),
      y: Math.round(pending.y),
    };
    onMappingChange({ ...mapping, [key]: entry });
    setSelected({ fieldId: key });
    setPending(null);
    setPickerStep(null);
  }

  function removeFieldEntry(fieldId: string) {
    const { [fieldId]: _gone, ...rest } = mapping;
    void _gone;
    onMappingChange(rest);
    if (selected?.fieldId === fieldId) setSelected(null);
  }

  function updateTextEntry(fieldId: string, patch: Partial<TextEntry>) {
    const cur = mapping[fieldId];
    if (!isTextEntry(cur)) return;
    onMappingChange({ ...mapping, [fieldId]: { ...cur, ...patch } });
  }

  function updateBoxEntry(fieldId: string, patch: Partial<BoxEntry>) {
    const cur = mapping[fieldId];
    if (!isBoxEntry(cur)) return;
    onMappingChange({ ...mapping, [fieldId]: { ...cur, ...patch } });
  }

  function updateOptionPosition(
    fieldId: string, optionName: string, patch: Partial<OptionPosition>,
  ) {
    const cur = mapping[fieldId];
    if (!isOptionsEntry(cur)) return;
    const existing = cur.options[optionName];
    if (!existing) return;
    onMappingChange({
      ...mapping,
      [fieldId]: {
        ...cur,
        options: { ...cur.options, [optionName]: { ...existing, ...patch } },
      },
    });
  }

  function updateDynamicEntry(fieldId: string, patch: Partial<DynamicPhotosEntry>) {
    const cur = mapping[fieldId];
    if (!isDynamicEntry(cur)) return;
    onMappingChange({ ...mapping, [fieldId]: { ...cur, ...patch } });
  }

  function updateOptionPart(
    fieldId: string, optionName: string, part: 'checkbox' | 'text',
    patch: Partial<{ page: number; x: number; y: number; size: number; fontSize: number }>,
  ) {
    const cur = mapping[fieldId];
    if (!isCheckboxesWithTextEntry(cur)) return;
    const opt = cur.options[optionName];
    if (!opt) return;
    const updated = { ...opt, [part]: { ...opt[part], ...patch } };
    onMappingChange({
      ...mapping,
      [fieldId]: { ...cur, options: { ...cur.options, [optionName]: updated } },
    });
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
    if (!pdfPath) return;
    const url = await getPdfSignedUrl(pdfPath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-maja-navy">
              {pdfName || 'PDF-Vorlage'}
            </h3>
            <p className="text-xs text-maja-muted">
              {pdfPath
                ? <>aktuell: <code className="rounded bg-maja-light px-1">{pdfPath}</code></>
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
              {uploading ? 'Wird hochgeladen …' : pdfPath ? 'PDF ersetzen' : 'PDF hochladen'}
            </label>
            {pdfPath && (
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
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
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
                Klick ins PDF → Feld auswählen. Bei Mehrfachauswahl-Feldern
                jede Option einzeln.
              </p>
            </div>
            <PdfMappingCanvas
              pdfBytes={pdfBytes}
              page={page}
              onPageCount={onPageCount}
              mapping={mapping}
              fieldLabels={fieldLabels}
              selected={selected}
              onClick={onCanvasClick}
              onMarkerClick={(sel) => {
                setSelected(sel);
                const e = mapping[sel.fieldId];
                if (isTextEntry(e) || isBoxEntry(e) || isDynamicEntry(e)) {
                  setPage(e.page);
                } else if (isOptionsEntry(e) && sel.optionName) {
                  const p = e.options[sel.optionName];
                  if (p) setPage(p.page);
                } else if (isCheckboxesWithTextEntry(e) && sel.optionName && sel.part) {
                  const p = e.options[sel.optionName];
                  if (p) setPage(p[sel.part].page);
                }
              }}
            />
          </div>

          <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-auto space-y-4">
            <OrphansBanner
              fields={fields}
              mapping={mapping}
              onRemove={(key) => {
                const { [key]: _gone, ...rest } = mapping;
                void _gone;
                onMappingChange(rest);
                if (selected?.fieldId === key) setSelected(null);
              }}
            />
            <FieldsSidebar
              fields={fields}
              mapping={mapping}
              page={page}
              selected={selected}
              onSelectField={(fid) => setSelected({ fieldId: fid })}
              onSelectOption={(fid, opt) => setSelected({ fieldId: fid, optionName: opt })}
              onRemoveField={removeFieldEntry}
              onRemoveOption={(fid, opt) => {
                onMappingChange(removeOption(mapping, fid, opt));
                if (selected?.fieldId === fid && selected?.optionName === opt) {
                  setSelected(null);
                }
              }}
              onJumpToPage={setPage}
            />

            {selected && (
              <DetailPanel
                selection={selected}
                mapping={mapping}
                fieldMap={fieldMap}
                onUpdateText={updateTextEntry}
                onUpdateBox={updateBoxEntry}
                onUpdateOption={updateOptionPosition}
                onUpdateDynamic={updateDynamicEntry}
                onUpdateOptionPart={updateOptionPart}
              />
            )}
          </aside>
        </div>
      )}

      {/* Stufe 1: Feld-Picker (alle Felder) */}
      {pending && !pickerStep && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-1 text-lg font-semibold text-maja-navy">Feld wählen</h2>
            <p className="mb-4 text-xs text-maja-muted">
              Position: Seite {pending.page}, x={Math.round(pending.x)} pt,
              y={Math.round(pending.y)} pt.
            </p>
            <div className="max-h-72 space-y-1 overflow-auto">
              {fields.length === 0 && (
                <p className="text-sm text-maja-muted">Es gibt noch keine Felder.</p>
              )}
              {fields.flatMap((f) => {
                // Address: 3 Sub-Felder pro Eintrag
                if (f.type === 'address') {
                  const subs: Array<{ key: 'strasse' | 'plz' | 'stadt'; label: string }> = [
                    { key: 'strasse', label: 'Straße' },
                    { key: 'plz',     label: 'PLZ' },
                    { key: 'stadt',   label: 'Stadt' },
                  ];
                  return subs.map((s) => {
                    const compositeKey = `${f.id}.${s.key}`;
                    const isMapped = !!mapping[compositeKey];
                    return (
                      <button
                        key={compositeKey}
                        type="button"
                        onClick={() => placeTextAtKey(compositeKey)}
                        className="flex w-full items-center justify-between rounded-lg border border-maja-navy/15 bg-white px-3 py-2 text-left text-sm hover:bg-maja-light"
                      >
                        <span>
                          <span className="font-medium text-maja-ink">{f.label}</span>
                          {' '}
                          <span className="text-xs text-maja-muted">– {s.label}</span>
                        </span>
                        {isMapped && <span className="text-xs text-amber-700">bereits gemappt</span>}
                      </button>
                    );
                  });
                }
                // Standardfall: ein Eintrag pro Feld
                const m = modeFor(f.type);
                const e = mapping[f.id];
                const tag =
                  m === 'options'
                    ? `${Object.keys(isOptionsEntry(e) ? e.options : {}).length}/${(f.options ?? []).length} Optionen gemappt`
                    : e ? 'bereits gemappt' : '';
                return [(
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => pickField(f)}
                    className="flex w-full items-center justify-between rounded-lg border border-maja-navy/15 bg-white px-3 py-2 text-left text-sm hover:bg-maja-light"
                  >
                    <span>
                      <span className="font-medium text-maja-ink">{f.label}</span>
                      {' '}
                      <span className="text-xs text-maja-muted">({f.type})</span>
                    </span>
                    {tag && <span className="text-xs text-amber-700">{tag}</span>}
                  </button>
                )];
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

      {/* Stufe 2: Options-Picker */}
      {pending && pickerStep && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-1 text-lg font-semibold text-maja-navy">
              Option für „{pickerStep.field.label}"
            </h2>
            <p className="mb-4 text-xs text-maja-muted">
              {pickerStep.field.type === 'checkboxes_with_text'
                ? 'Wähle pro Option, ob hier das Häkchen oder der Freitext platziert werden soll.'
                : 'Welche Option soll an dieser Stelle ein Häkchen bekommen?'}
            </p>
            <div className="max-h-72 space-y-1 overflow-auto">
              {(pickerStep.field.options ?? []).length === 0 && (
                <p className="text-sm text-maja-muted">
                  Dieses Feld hat noch keine Optionen. Pflege sie zuerst im Tab „Struktur".
                </p>
              )}
              {pickerStep.field.type === 'checkboxes_with_text'
                ? (pickerStep.field.options ?? []).map((opt) => {
                    const e = mapping[pickerStep.field.id];
                    const ce = isCheckboxesWithTextEntry(e) ? e.options[opt] : undefined;
                    return (
                      <div key={opt} className="rounded-lg border border-maja-navy/15 bg-white p-2">
                        <div className="mb-1 px-1 text-sm font-medium text-maja-ink">{opt}</div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => placeOptionPart(pickerStep.field, opt, 'checkbox')}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-maja-navy/15 px-2 py-1 text-xs hover:bg-maja-light"
                          >
                            <CheckBoxEmptyIcon className="h-3.5 w-3.5" />
                            Häkchen
                            {ce?.checkbox && <CheckIcon className="ml-1 h-3 w-3 text-amber-700" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => placeOptionPart(pickerStep.field, opt, 'text')}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-maja-navy/15 px-2 py-1 text-xs hover:bg-maja-light"
                          >
                            <span className="font-semibold">Aa</span> Text
                            {ce?.text && <CheckIcon className="ml-1 h-3 w-3 text-amber-700" />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                : (pickerStep.field.options ?? []).map((opt) => {
                const e = mapping[pickerStep.field.id];
                const already = isOptionsEntry(e) && !!e.options[opt];
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => placeOption(pickerStep.field, opt)}
                    className="flex w-full items-center justify-between rounded-lg border border-maja-navy/15 bg-white px-3 py-2 text-left text-sm hover:bg-maja-light"
                  >
                    <span className="font-medium text-maja-ink">{opt}</span>
                    {already && <span className="text-xs text-amber-700">bereits gemappt</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-between">
              <button type="button"
                      onClick={() => setPickerStep(null)}
                      className="text-sm font-medium text-maja-accent hover:underline">
                ← Anderes Feld
              </button>
              <button type="button" onClick={() => { setPending(null); setPickerStep(null); }}
                      className="btn-secondary">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Orphan-Warnung: Mapping-Schlüssel ohne passendes Feld ----------

function OrphansBanner({
  fields, mapping, onRemove,
}: {
  fields: FormField[];
  mapping: FieldMapping;
  onRemove: (key: string) => void;
}) {
  const knownIds = new Set(fields.map((f) => f.id));
  const orphans = Object.keys(mapping).filter((key) => {
    // Direkter Match
    if (knownIds.has(key)) return false;
    // Sub-Field-Keys "fieldId.subfield" — gültig wenn fieldId bekannt.
    const dot = key.indexOf('.');
    if (dot > 0 && knownIds.has(key.slice(0, dot))) return false;
    return true;
  });
  if (orphans.length === 0) return null;
  return (
    <div className="card border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <h3 className="text-sm font-semibold">Verwaiste Mapping-Einträge</h3>
      <p className="mt-1 text-xs">
        Diese Einträge zeigen auf Feld-IDs, die nicht mehr im Schema existieren
        (z.B. nach einer Umbenennung oder Löschung).
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {orphans.map((key) => (
          <li key={key} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1">
            <code className="break-all">{key}</code>
            <button
              type="button"
              onClick={() => onRemove(key)}
              className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
            >
              Löschen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Sidebar: alle Felder mit Mapping-Status ----------

function FieldsSidebar({
  fields, mapping, page, selected,
  onSelectField, onSelectOption,
  onRemoveField, onRemoveOption, onJumpToPage,
}: {
  fields: FormField[];
  mapping: FieldMapping;
  page: number;
  selected: Selection | null;
  onSelectField: (fieldId: string) => void;
  onSelectOption: (fieldId: string, optionName: string) => void;
  onRemoveField: (fieldId: string) => void;
  onRemoveOption: (fieldId: string, optionName: string) => void;
  onJumpToPage: (page: number) => void;
}) {
  // Address-Felder zu Sub-Rows aufdröseln, damit jeder Eintrag (Straße/PLZ/
  // Stadt) eigenständig sichtbar, anwählbar und löschbar ist.
  const ADDRESS_SUBS: Array<{ key: 'strasse' | 'plz' | 'stadt'; label: string }> = [
    { key: 'strasse', label: 'Straße' },
    { key: 'plz',     label: 'PLZ' },
    { key: 'stadt',   label: 'Stadt' },
  ];
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold text-maja-navy">Felder &amp; Mapping</h3>
      {fields.length === 0 && (
        <p className="text-xs text-maja-muted">Noch keine Felder definiert.</p>
      )}
      <ul className="space-y-1 text-sm">
        {fields.map((f) => {
          // Address: Eltern-Eintrag (read-only Header) + Sub-Rows.
          if (f.type === 'address') {
            return (
              <li key={f.id} className="rounded-md border border-maja-navy/10 bg-white">
                <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-maja-muted">
                  {f.label}
                </div>
                <ul className="ml-2 space-y-1 border-l border-maja-navy/10 pl-3 pb-2">
                  {ADDRESS_SUBS.map((sub) => {
                    const subKey = `${f.id}.${sub.key}`;
                    const subEntry = mapping[subKey];
                    const isSel = selected?.fieldId === subKey;
                    return (
                      <li key={subKey}
                          className={
                            'flex items-center justify-between rounded px-2 py-1 cursor-pointer ' +
                            (isSel ? 'bg-maja-accent/10' : 'hover:bg-maja-light/60')
                          }
                          onClick={() => onSelectField(subKey)}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{sub.label}</div>
                          <div className="text-[11px] text-maja-muted">
                            {isTextEntry(subEntry)
                              ? <>S.{subEntry.page} · ({Math.round(subEntry.x)}, {Math.round(subEntry.y)})</>
                              : 'noch nicht gemappt'}
                          </div>
                        </div>
                        {isTextEntry(subEntry) && (
                          <div className="flex items-center gap-2">
                            {subEntry.page !== page && (
                              <button
                                type="button"
                                onClick={(ev) => { ev.stopPropagation(); onJumpToPage(subEntry.page); }}
                                className="text-xs text-maja-accent hover:underline"
                              >S.{subEntry.page}</button>
                            )}
                            <button
                              type="button"
                              onClick={(ev) => { ev.stopPropagation(); onRemoveField(subKey); }}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >×</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          }

          const e = mapping[f.id];
          const onPage = isFieldMappedOnPage(e, page);
          return (
            <li key={f.id} className="rounded-md border border-maja-navy/10 bg-white">
              <div
                className={
                  'flex items-center justify-between px-2 py-1.5 cursor-pointer ' +
                  (selected?.fieldId === f.id && !selected?.optionName
                    ? 'bg-maja-accent/10 rounded-md'
                    : 'hover:bg-maja-light/60 rounded-md')
                }
                onClick={() => onSelectField(f.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-maja-ink">{f.label}</div>
                  <div className="text-xs text-maja-muted">
                    {f.type}
                    {isTextEntry(e) && (
                      <> · S.{e.page} · ({Math.round(e.x)}, {Math.round(e.y)})</>
                    )}
                    {isBoxEntry(e) && (
                      <> · S.{e.page} · {Math.round(e.width)}×{Math.round(e.height)} pt</>
                    )}
                    {isOptionsEntry(e) && (
                      <> · {Object.keys(e.options).length}/{(f.options ?? []).length} Optionen</>
                    )}
                    {isDynamicEntry(e) && (
                      <> · S.{e.page} · {e.perPage} Slots/Seite ({e.columns} Spalten)</>
                    )}
                    {!e && <> · noch nicht gemappt</>}
                  </div>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  {(isTextEntry(e) || isBoxEntry(e) || isDynamicEntry(e)) && e.page !== page && (
                    <button
                      type="button"
                      title="zur Seite springen"
                      onClick={(ev) => { ev.stopPropagation(); onJumpToPage(e.page); }}
                      className="text-xs text-maja-accent hover:underline"
                    >S.{e.page}</button>
                  )}
                  {e && (
                    <button
                      type="button"
                      title="Mapping entfernen"
                      onClick={(ev) => { ev.stopPropagation(); onRemoveField(f.id); }}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >×</button>
                  )}
                  {!onPage && e && (isTextEntry(e) || isBoxEntry(e)) && (
                    <span className="text-xs text-maja-muted" title="anders Seite">·</span>
                  )}
                </div>
              </div>

              {isOptionsEntry(e) && (
                <ul className="ml-2 border-l border-maja-navy/10 pl-3 py-1">
                  {(f.options ?? []).map((opt) => {
                    const p = e.options[opt];
                    const isSel = selected?.fieldId === f.id && selected?.optionName === opt;
                    return (
                      <li key={opt}
                          className={
                            'flex items-center justify-between rounded px-2 py-1 cursor-pointer ' +
                            (isSel ? 'bg-maja-accent/10' : 'hover:bg-maja-light/60')
                          }
                          onClick={() => p && onSelectOption(f.id, opt)}>
                        <span className="truncate text-xs">
                          {opt}
                          {p ? <span className="ml-1 text-maja-muted">S.{p.page} · ({Math.round(p.x)}, {Math.round(p.y)})</span>
                             : <span className="ml-1 text-amber-700">— offen</span>}
                        </span>
                        {p && (
                          <div className="flex items-center gap-2">
                            {p.page !== page && (
                              <button
                                type="button"
                                onClick={(ev) => { ev.stopPropagation(); onJumpToPage(p.page); }}
                                className="text-xs text-maja-accent hover:underline"
                              >S.{p.page}</button>
                            )}
                            <button
                              type="button"
                              onClick={(ev) => { ev.stopPropagation(); onRemoveOption(f.id, opt); }}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >×</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Detail-Panel ----------

function DetailPanel({
  selection, mapping, fieldMap,
  onUpdateText, onUpdateBox, onUpdateOption, onUpdateDynamic, onUpdateOptionPart,
}: {
  selection: Selection;
  mapping: FieldMapping;
  fieldMap: Map<string, FormField>;
  onUpdateText: (fieldId: string, patch: Partial<TextEntry>) => void;
  onUpdateBox: (fieldId: string, patch: Partial<BoxEntry>) => void;
  onUpdateOption: (
    fieldId: string, optionName: string, patch: Partial<OptionPosition>,
  ) => void;
  onUpdateDynamic: (fieldId: string, patch: Partial<DynamicPhotosEntry>) => void;
  onUpdateOptionPart: (
    fieldId: string, optionName: string, part: 'checkbox' | 'text',
    patch: Partial<{ page: number; x: number; y: number; size: number; fontSize: number }>,
  ) => void;
}) {
  // Composite-Key-Auflösung: Sub-Field-Schlüssel wie "adresse.strasse"
  // verweisen auf das Eltern-Feld, der Sub-Name liefert das passende Label.
  const dot = selection.fieldId.indexOf('.');
  const parentField = dot > 0 ? fieldMap.get(selection.fieldId.slice(0, dot)) : null;
  const subKey = dot > 0 ? selection.fieldId.slice(dot + 1) : null;
  const SUB_LABEL: Record<string, string> = {
    strasse: 'Straße', plz: 'PLZ', stadt: 'Stadt',
  };
  const field = fieldMap.get(selection.fieldId) ?? parentField;
  const entry = mapping[selection.fieldId];
  if (!field || !entry) return null;
  const headerLabel = subKey
    ? `${field.label} – ${SUB_LABEL[subKey] ?? subKey}`
    : field.label;

  if (isTextEntry(entry)) {
    return (
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-maja-navy">{headerLabel}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberCell label="Seite"  value={entry.page} min={1}
                      onChange={(v) => onUpdateText(selection.fieldId, { page: v })} />
          <NumberCell label="Schriftgröße" value={entry.fontSize ?? TEXT_DEFAULT_FONT} min={4}
                      onChange={(v) => onUpdateText(selection.fieldId, { fontSize: v })} />
          <NumberCell label="X (pt)" value={entry.x}
                      onChange={(v) => onUpdateText(selection.fieldId, { x: v })} />
          <NumberCell label="Y (pt)" value={entry.y}
                      onChange={(v) => onUpdateText(selection.fieldId, { y: v })} />
          <NumberCell
            label="Max-Breite (pt, 0 = aus)"
            value={entry.maxWidth ?? 0}
            min={0}
            onChange={(v) => onUpdateText(selection.fieldId, {
              maxWidth: v > 0 ? v : undefined,
            })}
          />
        </div>
        <p className="mt-2 text-xs text-maja-muted">
          Max-Breite aktiviert die Auto-Anpassung: zu lange Texte verkleinern sich
          erst (bis 7 pt) und werden danach auf bis zu 3 Zeilen umbrochen.
        </p>
      </div>
    );
  }

  if (isBoxEntry(entry)) {
    return (
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-maja-navy">{field.label}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberCell label="Seite"  value={entry.page} min={1}
                      onChange={(v) => onUpdateBox(selection.fieldId, { page: v })} />
          <NumberCell label="X (pt)" value={entry.x}
                      onChange={(v) => onUpdateBox(selection.fieldId, { x: v })} />
          <NumberCell label="Y (pt)" value={entry.y}
                      onChange={(v) => onUpdateBox(selection.fieldId, { y: v })} />
          <div />
          <NumberCell label="Breite (pt)" value={entry.width ?? PHOTO_DEFAULT_WIDTH} min={10}
                      onChange={(v) => onUpdateBox(selection.fieldId, { width: v })} />
          <NumberCell label="Höhe (pt)" value={entry.height ?? PHOTO_DEFAULT_HEIGHT} min={10}
                      onChange={(v) => onUpdateBox(selection.fieldId, { height: v })} />
        </div>
      </div>
    );
  }

  // options
  if (isOptionsEntry(entry) && selection.optionName) {
    const opt = entry.options[selection.optionName];
    if (!opt) return null;
    return (
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-maja-navy">{field.label}</h3>
        <p className="mb-3 text-xs text-maja-muted">Option: {selection.optionName}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberCell label="Seite"  value={opt.page} min={1}
                      onChange={(v) => onUpdateOption(selection.fieldId, selection.optionName!, { page: v })} />
          <NumberCell label="Häkchen-Größe" value={opt.size ?? OPTION_DEFAULT_SIZE} min={4}
                      onChange={(v) => onUpdateOption(selection.fieldId, selection.optionName!, { size: v })} />
          <NumberCell label="X (pt)" value={opt.x}
                      onChange={(v) => onUpdateOption(selection.fieldId, selection.optionName!, { x: v })} />
          <NumberCell label="Y (pt)" value={opt.y}
                      onChange={(v) => onUpdateOption(selection.fieldId, selection.optionName!, { y: v })} />
        </div>
      </div>
    );
  }

  if (isDynamicEntry(entry)) {
    return (
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-maja-navy">{field.label}</h3>
        <p className="mb-3 text-xs text-maja-muted">
          Dynamische Foto-Slots. Bei mehr Fotos als „Slots pro Seite" wird
          beim PDF-Export automatisch eine neue Seite eingefügt.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberCell label="Seite"  value={entry.page} min={1}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { page: v })} />
          <div />
          <NumberCell label="X (pt)" value={entry.x}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { x: v })} />
          <NumberCell label="Y (pt)" value={entry.y}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { y: v })} />
          <NumberCell label="Slot-Breite (pt)" value={entry.width} min={10}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { width: v })} />
          <NumberCell label="Slot-Höhe (pt)" value={entry.height} min={10}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { height: v })} />
          <NumberCell label="Spalten" value={entry.columns} min={1}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { columns: v })} />
          <NumberCell label="Slots pro Seite" value={entry.perPage} min={1}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { perPage: v })} />
          <NumberCell label="Spalten-Abstand" value={entry.colGap ?? 12}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { colGap: v })} />
          <NumberCell label="Reihen-Abstand" value={entry.rowGap ?? 12}
                      onChange={(v) => onUpdateDynamic(selection.fieldId, { rowGap: v })} />
        </div>
      </div>
    );
  }

  if (isCheckboxesWithTextEntry(entry) && selection.optionName && selection.part) {
    const opt = entry.options[selection.optionName];
    if (!opt) return null;
    if (selection.part === 'checkbox') {
      const cb = opt.checkbox;
      return (
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-maja-navy">{field.label}</h3>
          <p className="mb-3 text-xs text-maja-muted">
            Häkchen für: {selection.optionName}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <NumberCell label="Seite" value={cb.page} min={1}
                        onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'checkbox', { page: v })} />
            <NumberCell label="Größe" value={cb.size ?? OPTION_DEFAULT_SIZE} min={4}
                        onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'checkbox', { size: v })} />
            <NumberCell label="X (pt)" value={cb.x}
                        onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'checkbox', { x: v })} />
            <NumberCell label="Y (pt)" value={cb.y}
                        onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'checkbox', { y: v })} />
          </div>
        </div>
      );
    }
    const tx = opt.text;
    return (
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-maja-navy">{field.label}</h3>
        <p className="mb-3 text-xs text-maja-muted">
          Freitext für: {selection.optionName}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberCell label="Seite" value={tx.page} min={1}
                      onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'text', { page: v })} />
          <NumberCell label="Schriftgröße" value={tx.fontSize ?? TEXT_DEFAULT_FONT} min={4}
                      onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'text', { fontSize: v })} />
          <NumberCell label="X (pt)" value={tx.x}
                      onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'text', { x: v })} />
          <NumberCell label="Y (pt)" value={tx.y}
                      onChange={(v) => onUpdateOptionPart(selection.fieldId, selection.optionName!, 'text', { y: v })} />
        </div>
      </div>
    );
  }

  return null;
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
