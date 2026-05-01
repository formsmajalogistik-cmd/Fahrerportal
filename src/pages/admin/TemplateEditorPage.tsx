import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TemplateStructureEditor } from './TemplateStructureEditor';
import { TemplateMappingEditor } from './TemplateMappingEditor';
import { copyPdfInStorage, deletePdfFromStorage } from '../../lib/pdfStorage';
import type {
  Auftraggeber, FieldMapping, FormSchema, FormularTemplate, TemplatePdf,
} from '../../types/db';
import type { Json } from '../../types/supabase';

type Tab = 'struktur' | 'mapping';

const MAX_PDFS = 3;

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] ?? c))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'pdf';
}

function uniquePdfId(base: string, existing: TemplatePdf[]): string {
  let id = slugify(base);
  let i = 1;
  while (existing.some((p) => p.id === id)) {
    i += 1;
    id = `${slugify(base)}_${i}`;
  }
  return id;
}

export function TemplateEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [name, setName] = useState('');
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  const [schema, setSchema] = useState<FormSchema>({ sections: [] });
  const [pdfs, setPdfs] = useState<TemplatePdf[]>([]);
  const [activePdfId, setActivePdfId] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('struktur');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePdf, setConfirmDeletePdf] = useState<TemplatePdf | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [{ data: tpl, error: tplErr }, { data: ag }] = await Promise.all([
      supabase.from('formular_templates').select('*').eq('id', id).maybeSingle(),
      supabase.from('auftraggeber').select('*').order('name'),
    ]);
    if (tplErr || !tpl) {
      setError(tplErr?.message ?? 'Template nicht gefunden');
      setLoading(false);
      return;
    }
    const t = tpl as unknown as FormularTemplate;
    setTemplate(t);
    setName(t.name);
    setAuftraggeberId(t.auftraggeber_id ?? '');
    setSchema(
      t.schema && typeof t.schema === 'object' && 'sections' in t.schema
        ? (t.schema as FormSchema)
        : { sections: [] },
    );
    const loadedPdfs = Array.isArray(t.pdfs) ? (t.pdfs as TemplatePdf[]) : [];
    setPdfs(loadedPdfs);
    setActivePdfId((cur) => cur ?? loadedPdfs[0]?.id ?? null);
    setAuftraggeber(ag ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const { fieldCount, sectionCount, mappingCount } = useMemo(() => {
    const sections = schema.sections ?? [];
    const fc = sections.reduce((acc, s) => acc + (s.fields?.length ?? 0), 0);
    const mc = pdfs.reduce(
      (acc, p) => acc + Object.keys(p.field_mapping ?? {}).length, 0,
    );
    return { sectionCount: sections.length, fieldCount: fc, mappingCount: mc };
  }, [schema, pdfs]);

  const activePdf = useMemo(
    () => pdfs.find((p) => p.id === activePdfId) ?? null,
    [pdfs, activePdfId],
  );

  async function save() {
    if (!template) return;
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    const { error: err } = await supabase
      .from('formular_templates')
      .update({
        name: name.trim() || 'Unbenanntes Template',
        auftraggeber_id: auftraggeberId || null,
        schema: schema as unknown as Json,
        pdfs: pdfs as unknown as Json,
      })
      .eq('id', template.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setStatusMsg('Template gespeichert.');
  }

  async function handleDelete() {
    if (!template) return;
    const { error: err } = await supabase
      .from('formular_templates').delete().eq('id', template.id);
    if (err) throw err;
    navigate('/templates');
  }

  const [duplicating, setDuplicating] = useState(false);

  async function handleDuplicate() {
    if (!template || duplicating) return;
    setDuplicating(true);
    setError(null);
    setStatusMsg(null);
    try {
      // Schritt 1: leeres Duplikat anlegen, um die neue ID zu bekommen.
      const { data: created, error: insErr } = await supabase
        .from('formular_templates')
        .insert({
          name: `${name.trim() || 'Unbenanntes Template'} (Kopie)`,
          auftraggeber_id: auftraggeberId || null,
          schema: schema as unknown as Json,
          pdfs: [] as unknown as Json,
        })
        .select('id')
        .single();
      if (insErr || !created) throw insErr ?? new Error('Anlegen fehlgeschlagen');

      // Schritt 2: PDF-Dateien im Storage kopieren, neue Pfade einsammeln.
      const newPdfs: TemplatePdf[] = [];
      for (const p of pdfs) {
        let newPath: string | null = null;
        if (p.path) newPath = await copyPdfInStorage(p.path, created.id, p.id);
        newPdfs.push({
          id: p.id,
          name: p.name,
          path: newPath,
          field_mapping: p.field_mapping ?? {},
        });
      }

      // Schritt 3: pdfs[] auf das Duplikat setzen.
      const { error: updErr } = await supabase
        .from('formular_templates')
        .update({ pdfs: newPdfs as unknown as Json })
        .eq('id', created.id);
      if (updErr) throw updErr;

      navigate(`/templates/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplizieren fehlgeschlagen');
    } finally {
      setDuplicating(false);
    }
  }

  function addPdf() {
    if (pdfs.length >= MAX_PDFS) return;
    const baseName = pdfs.length === 0
      ? 'Protokoll'
      : pdfs.length === 1 ? 'Fotodokumentation'
      : 'Belege';
    const newPdf: TemplatePdf = {
      id: uniquePdfId(baseName, pdfs),
      name: baseName,
      path: null,
      field_mapping: {},
    };
    setPdfs([...pdfs, newPdf]);
    setActivePdfId(newPdf.id);
    setTab('mapping');
  }

  function renamePdf(pdfId: string, newName: string) {
    setPdfs(pdfs.map((p) => (p.id === pdfId ? { ...p, name: newName } : p)));
  }

  async function deletePdf(pdf: TemplatePdf) {
    if (pdf.path) await deletePdfFromStorage(pdf.path);
    const next = pdfs.filter((p) => p.id !== pdf.id);
    setPdfs(next);
    if (activePdfId === pdf.id) {
      setActivePdfId(next[0]?.id ?? null);
    }
    setConfirmDeletePdf(null);
  }

  function updatePdfMapping(pdfId: string, mapping: FieldMapping) {
    setPdfs(pdfs.map((p) => (p.id === pdfId ? { ...p, field_mapping: mapping } : p)));
  }

  function updatePdfPath(pdfId: string, path: string) {
    setPdfs(pdfs.map((p) => (p.id === pdfId ? { ...p, path } : p)));
  }

  function updatePdfPattern(pdfId: string, pattern: string) {
    setPdfs(pdfs.map((p) => (p.id === pdfId ? { ...p, filename_pattern: pattern || null } : p)));
  }

  const allFieldIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of schema.sections ?? []) for (const f of s.fields ?? []) ids.push(f.id);
    return ids;
  }, [schema]);

  if (loading) return <Spinner label="Template wird geladen …" />;
  if (error && !template) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        <button onClick={() => navigate('/templates')} className="btn-secondary">Zurück</button>
      </div>
    );
  }
  if (!template) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/templates')}
                  className="text-sm text-maja-accent hover:underline">
            ← Alle Templates
          </button>
          <h1 className="mt-1 text-2xl font-semibold text-maja-navy">Template bearbeiten</h1>
          <p className="text-sm text-maja-muted">
            {sectionCount} Sektionen · {fieldCount} Felder · {pdfs.length} PDF{pdfs.length === 1 ? '' : 's'} · {mappingCount} PDF-Mappings
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setConfirmDelete(true)}
                  className="text-sm font-medium text-red-600 hover:underline">
            Template löschen
          </button>
          <button onClick={handleDuplicate} className="btn-secondary" disabled={duplicating}>
            {duplicating ? 'Dupliziere …' : 'Duplizieren'}
          </button>
          <button onClick={save} className="btn-primary" disabled={saving}>
            {saving ? 'Speichern …' : 'Speichern'}
          </button>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tpl-name" className="label">Name</label>
            <input id="tpl-name" className="input" value={name}
                   onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tpl-ag" className="label">Auftraggeber</label>
            <select id="tpl-ag" className="input" value={auftraggeberId}
                    onChange={(e) => setAuftraggeberId(e.target.value)}>
              <option value="">— kein Auftraggeber —</option>
              {auftraggeber.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-maja-navy/10">
        <TabButton active={tab === 'struktur'} onClick={() => setTab('struktur')}>
          Struktur
        </TabButton>
        <TabButton active={tab === 'mapping'} onClick={() => setTab('mapping')}>
          PDF-Mapping
        </TabButton>
      </div>

      {tab === 'struktur' && (
        <TemplateStructureEditor templateId={template.id} schema={schema} onChange={setSchema} />
      )}

      {tab === 'mapping' && (
        <div className="space-y-4">
          <PdfTabs
            pdfs={pdfs}
            activeId={activePdfId}
            onSelect={setActivePdfId}
            onRename={renamePdf}
            onDelete={(pdf) => setConfirmDeletePdf(pdf)}
            onAdd={addPdf}
            onPatternChange={updatePdfPattern}
            fieldIds={allFieldIds}
            canAdd={pdfs.length < MAX_PDFS}
          />
          {activePdf ? (
            <TemplateMappingEditor
              templateId={template.id}
              pdfId={activePdf.id}
              pdfName={activePdf.name}
              schema={schema}
              mapping={activePdf.field_mapping}
              pdfPath={activePdf.path}
              onMappingChange={(m) => updatePdfMapping(activePdf.id, m)}
              onPdfPathChange={(p) => updatePdfPath(activePdf.id, p)}
            />
          ) : (
            <div className="card p-6 text-sm text-maja-muted">
              Noch keine PDF angelegt. Klicke oben auf „+ PDF hinzufügen", um eine
              Vorlage hochzuladen und Felder zu positionieren.
            </div>
          )}
        </div>
      )}

      {(error || statusMsg) && (
        <div className="sticky bottom-4 z-10">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {statusMsg && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {statusMsg}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Template löschen?"
          message={
            <>
              Soll „<strong>{template.name}</strong>" wirklich gelöscht werden?
              Bestehende Zuweisungen werden entfernt. Protokolle, die damit
              ausgefüllt wurden, verhindern das Löschen.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {confirmDeletePdf && (
        <ConfirmDialog
          title="PDF-Vorlage entfernen?"
          message={
            <>
              Soll die PDF „<strong>{confirmDeletePdf.name}</strong>" inklusive
              ihres Field-Mappings entfernt werden? Die hochgeladene Datei wird
              aus dem Storage gelöscht.
            </>
          }
          confirmLabel="Entfernen"
          destructive
          onConfirm={() => deletePdf(confirmDeletePdf)}
          onClose={() => setConfirmDeletePdf(null)}
        />
      )}
    </div>
  );
}

function PdfTabs({
  pdfs, activeId, onSelect, onRename, onDelete, onAdd, onPatternChange, fieldIds, canAdd,
}: {
  pdfs: TemplatePdf[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (pdf: TemplatePdf) => void;
  onAdd: () => void;
  onPatternChange: (id: string, pattern: string) => void;
  fieldIds: string[];
  canAdd: boolean;
}) {
  const active = pdfs.find((p) => p.id === activeId) ?? null;
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {pdfs.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={
              'rounded-lg px-3 py-1.5 text-sm font-medium transition ' +
              (p.id === activeId
                ? 'bg-maja-navy text-white'
                : 'bg-maja-light text-maja-navy hover:bg-maja-light/70')
            }
          >
            {p.name}
            {p.path == null && <span className="ml-1 text-xs opacity-70">(leer)</span>}
          </button>
        ))}
        {canAdd && (
          <button type="button" onClick={onAdd} className="btn-secondary px-3 py-1.5 text-sm">
            + PDF hinzufügen
          </button>
        )}
      </div>
      {active && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-maja-navy/10 pt-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label">PDF-Name</label>
            <input
              className="input"
              value={active.name}
              onChange={(e) => onRename(active.id, e.target.value)}
            />
          </div>
          <div className="text-xs text-maja-muted">
            ID: <code className="rounded bg-maja-light px-1">{active.id}</code>
          </div>
          <button
            type="button"
            onClick={() => onDelete(active)}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            PDF entfernen
          </button>

          <FilenamePatternRow
            value={active.filename_pattern ?? ''}
            onChange={(v) => onPatternChange(active.id, v)}
            fallback={active.id}
            fieldIds={fieldIds}
          />
        </div>
      )}
    </div>
  );
}

function FilenamePatternRow({
  value, onChange, fallback, fieldIds,
}: {
  value: string;
  onChange: (v: string) => void;
  fallback: string;
  fieldIds: string[];
}) {
  return (
    <div className="mt-3 w-full border-t border-maja-navy/10 pt-3">
      <label className="label">Dateiname-Muster (optional)</label>
      <input
        className="input"
        placeholder={`z.B. ${fallback}_{kennzeichen}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1 text-xs text-maja-muted">
        Platzhalter <code className="rounded bg-maja-light px-1">{'{feld_id}'}</code> werden
        beim Generieren durch die Werte aus dem Formular ersetzt. Sonderzeichen
        (z.B. Leerzeichen im Kennzeichen) werden automatisch durch „_" ersetzt.
        Beispiel: <code className="rounded bg-maja-light px-1">Protokoll_{'{kennzeichen}'}</code>
        {' '}→ <code>Protokoll_HB-ML_421.pdf</code>.
      </p>
      {fieldIds.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-maja-accent hover:underline">
            Verfügbare Platzhalter ({fieldIds.length}) anzeigen
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {fieldIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onChange((value || '') + `{${id}}`)}
                title="In Pattern einfügen"
                className="rounded-full bg-maja-light px-2 py-0.5 text-[11px] text-maja-navy hover:bg-maja-accent/20"
              >
                {`{${id}}`}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ' +
        (active
          ? 'border-maja-navy text-maja-navy'
          : 'border-transparent text-maja-muted hover:text-maja-navy')
      }
    >
      {children}
    </button>
  );
}
