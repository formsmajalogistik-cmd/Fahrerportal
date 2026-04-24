import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TemplateStructureEditor } from './TemplateStructureEditor';
import { TemplateMappingEditor } from './TemplateMappingEditor';
import type {
  Auftraggeber,
  FieldMapping,
  FormSchema,
  FormularTemplate,
} from '../../types/db';
import type { Json } from '../../types/supabase';

type Tab = 'struktur' | 'mapping';

export function TemplateEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [name, setName] = useState('');
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  const [schema, setSchema] = useState<FormSchema>({ sections: [] });
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [pdfTemplate, setPdfTemplate] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('struktur');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setMapping((t.field_mapping as FieldMapping) ?? {});
    setPdfTemplate(t.pdf_template);
    setAuftraggeber(ag ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const { fieldCount, sectionCount } = useMemo(() => {
    const sections = schema.sections ?? [];
    const fc = sections.reduce((acc, s) => acc + (s.fields?.length ?? 0), 0);
    return { sectionCount: sections.length, fieldCount: fc };
  }, [schema]);

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
        field_mapping: mapping as unknown as Json,
        pdf_template: pdfTemplate,
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
            {sectionCount} Sektionen · {fieldCount} Felder · {Object.keys(mapping).length} PDF-Mappings
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setConfirmDelete(true)}
                  className="text-sm font-medium text-red-600 hover:underline">
            Template löschen
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
        <TemplateStructureEditor schema={schema} onChange={setSchema} />
      )}

      {tab === 'mapping' && (
        <TemplateMappingEditor
          templateId={template.id}
          schema={schema}
          mapping={mapping}
          pdfTemplate={pdfTemplate}
          onMappingChange={setMapping}
          onPdfTemplateChange={setPdfTemplate}
        />
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
