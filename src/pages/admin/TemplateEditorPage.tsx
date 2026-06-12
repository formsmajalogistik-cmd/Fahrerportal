import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog';
import { TemplateStructureEditor } from './TemplateStructureEditor';
import { TemplateMappingEditor } from './TemplateMappingEditor';
import { TemplateEmailEditor } from './TemplateEmailEditor';
import { TemplateFreigabeEditor } from './TemplateFreigabeEditor';
import { copyPdfInStorage, deletePdfFromStorage } from '../../lib/pdfStorage';
import type {
  EmailConfig, FieldMapping, FormSchema, FormularTemplate, TemplatePdf,
} from '../../types/db';
import { ADDRESS_LABEL, ADDRESS_SUBFIELDS } from '../../types/db';
import type { Json } from '../../types/supabase';

export interface PlaceholderToken {
  /** Der Platzhalter, der ins Pattern eingefügt wird, inkl. der geschweiften Klammern. */
  token: string;
  /** Optionale Beschriftung — z.B. „adresse.straße" mit Umlaut. */
  label?: string;
}

type Tab = 'struktur' | 'mapping' | 'email' | 'freigabe';

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
  const [name, setName] = useState('');
  const [schema, setSchema] = useState<FormSchema>({ sections: [] });
  const [pdfs, setPdfs] = useState<TemplatePdf[]>([]);
  const [activePdfId, setActivePdfId] = useState<string | null>(null);
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);

  const [tab, setTab] = useState<Tab>('struktur');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePdf, setConfirmDeletePdf] = useState<TemplatePdf | null>(null);

  // Dirty-Tracking: Snapshot des zuletzt gespeicherten Stands wird
  // beim Laden und nach jedem Save in `savedSnapshot` geschrieben. Wir
  // verwenden ein State (statt Ref), damit der Vergleich während des
  // Renders zulässig ist.
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const liveSnapshot = useMemo(
    () => JSON.stringify({ name, schema, pdfs, emailConfig }),
    [name, schema, pdfs, emailConfig],
  );
  const dirty = !loading && savedSnapshot !== '' && savedSnapshot !== liveSnapshot;
  /** Pending-Navigation: ziel-URL oder Funktion, die nach Bestätigung läuft. */
  const [pendingExit, setPendingExit] = useState<null | { kind: 'navigate'; to: string } | { kind: 'run'; run: () => void }>(null);

  function safeNavigate(to: string) {
    if (dirty) { setPendingExit({ kind: 'navigate', to }); return; }
    navigate(to);
  }
  function guardedRun(run: () => void) {
    if (dirty) { setPendingExit({ kind: 'run', run }); return; }
    run();
  }

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const { data: tpl, error: tplErr } = await supabase
      .from('formular_templates').select('*').eq('id', id).maybeSingle();
    if (tplErr || !tpl) {
      setError(tplErr?.message ?? 'Template nicht gefunden');
      setLoading(false);
      return;
    }
    const t = tpl as unknown as FormularTemplate;
    setTemplate(t);
    setName(t.name);
    setSchema(
      t.schema && typeof t.schema === 'object' && 'sections' in t.schema
        ? (t.schema as FormSchema)
        : { sections: [] },
    );
    const loadedPdfs = Array.isArray(t.pdfs) ? (t.pdfs as TemplatePdf[]) : [];
    setPdfs(loadedPdfs);
    setActivePdfId((cur) => cur ?? loadedPdfs[0]?.id ?? null);
    const loadedEmailConfig = (t.email_config as EmailConfig | null) ?? null;
    setEmailConfig(loadedEmailConfig);
    // Snapshot des zuletzt-gespeicherten Stands für Dirty-Vergleich.
    setSavedSnapshot(JSON.stringify({
      name: t.name,
      schema: t.schema && typeof t.schema === 'object' && 'sections' in t.schema
        ? t.schema as FormSchema : { sections: [] },
      pdfs: loadedPdfs,
      emailConfig: loadedEmailConfig,
    }));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Aufgabe 1: Browser-Warnung beim Tab-Schließen / Reload, solange
  // ungespeicherte Änderungen vorliegen.
  useEffect(() => {
    if (!dirty) return undefined;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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
    const cleanName = name.trim() || 'Unbenanntes Template';
    const { error: err } = await supabase
      .from('formular_templates')
      .update({
        name: cleanName,
        schema: schema as unknown as Json,
        pdfs: pdfs as unknown as Json,
        email_config: (emailConfig ?? null) as unknown as Json,
      })
      .eq('id', template.id);
    setSaving(false);
    if (err) { setError(err.message); throw new Error(err.message); }
    // Snapshot nach erfolgreichem Save aktualisieren — Editor ist
    // wieder „sauber".
    setSavedSnapshot(JSON.stringify({
      name: cleanName, schema, pdfs, emailConfig,
    }));
    setStatusMsg('Template gespeichert.');
    // Auto-hide nach 3 s
    window.setTimeout(() => setStatusMsg((m) => m === 'Template gespeichert.' ? null : m), 3000);
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
          schema: schema as unknown as Json,
          pdfs: [] as unknown as Json,
          email_config: (emailConfig ?? null) as unknown as Json,
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
    // Kein hartes Limit mehr — der Admin kann beliebig viele PDF-Vorlagen
    // anlegen (z.B. Fotos_Übernahme, Fotos_Übergabe, Fotos_Schäden, …).
    const defaultNames = ['Protokoll', 'Fotodokumentation', 'Belege'];
    const baseName = defaultNames[pdfs.length] ?? `PDF ${pdfs.length + 1}`;
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

  /**
   * Verfügbare Platzhalter inkl. Sub-Felder für zusammengesetzte Feld-
   * typen (Adresse → strasse / plz / stadt). Wird im Email-Editor und
   * im Dateiname-Pattern angezeigt. Zusätzlich werden ein paar
   * abgeleitete Platzhalter (template_name, datum, fahrer_name)
   * vorgeschlagen, die der submissionEmails-Helper beim Versand
   * automatisch auflöst.
   */
  const placeholderTokens = useMemo<PlaceholderToken[]>(() => {
    const out: PlaceholderToken[] = [];
    const seen = new Set<string>();
    const add = (token: string, label?: string) => {
      if (seen.has(token)) return;
      seen.add(token);
      out.push({ token, label });
    };
    // Schema-Felder
    for (const s of schema.sections ?? []) {
      for (const f of s.fields ?? []) {
        if (f.type === 'address') {
          for (const sub of ADDRESS_SUBFIELDS) {
            add(`{${f.id}.${sub}}`, `${f.id}.${ADDRESS_LABEL[sub].toLowerCase()}`);
          }
        } else {
          add(`{${f.id}}`);
        }
      }
    }
    // Abgeleitete Platzhalter — sind nicht im Schema, der submissionEmails
    // Helper befüllt sie aus dem Template / Profil. Schema-Felder mit
    // gleichem Namen überschreiben sie beim Auflösen.
    add('{template_name}', 'Template-Name');
    add('{datum}', 'Einreichungs-Datum');
    add('{fahrer_name}', 'Fahrer-Anzeigename');
    add('{kennzeichen}', 'KFZ-Kennzeichen (Feld kennzeichen)');
    add('{stadt_start}');
    add('{stadt_ziel}');
    add('{fin}');
    add('{kundenname}');
    add('{auftraggeber}');
    return out;
  }, [schema]);

  if (loading) return <Spinner label="Template wird geladen …" />;
  if (error && !template) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        <button onClick={() => safeNavigate('/templates')} className="btn-secondary">Zurück</button>
      </div>
    );
  }
  if (!template) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => safeNavigate('/templates')}
                  className="text-sm text-maja-accent hover:underline">
            ← Alle Templates
          </button>
          <h1 className="mt-1 text-2xl font-semibold text-maja-navy">
            Template bearbeiten
            {dirty && (
              <span className="ml-2 align-middle text-xs font-normal text-amber-700">• ungespeicherte Änderungen</span>
            )}
          </h1>
          <p className="text-sm text-maja-muted">
            {sectionCount} Sektionen · {fieldCount} Felder · {pdfs.length} PDF{pdfs.length === 1 ? '' : 's'} · {mappingCount} PDF-Mappings
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => guardedRun(() => setConfirmDelete(true))}
                  className="text-sm font-medium text-red-600 hover:underline">
            Template löschen
          </button>
          <button onClick={() => guardedRun(handleDuplicate)} className="btn-secondary" disabled={duplicating}>
            {duplicating ? 'Dupliziere …' : 'Duplizieren'}
          </button>
          <button onClick={() => void save().catch(() => {})} className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Speichern …' : 'Speichern'}
          </button>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <label htmlFor="tpl-name" className="label">Name</label>
          <input id="tpl-name" className="input" value={name}
                 onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-maja-navy/10">
        <TabButton active={tab === 'struktur'} onClick={() => setTab('struktur')}>
          Struktur
        </TabButton>
        <TabButton active={tab === 'mapping'} onClick={() => setTab('mapping')}>
          PDF-Mapping
        </TabButton>
        <TabButton active={tab === 'email'} onClick={() => setTab('email')}>
          Email
        </TabButton>
        <TabButton active={tab === 'freigabe'} onClick={() => setTab('freigabe')}>
          Auftraggeber-Freigabe
        </TabButton>
      </div>
      {pendingExit && (
        <UnsavedChangesDialog
          onSave={async () => { await save(); }}
          onLeave={() => {
            const exit = pendingExit;
            setPendingExit(null);
            if (exit.kind === 'navigate') navigate(exit.to);
            else exit.run();
          }}
          onCancel={() => setPendingExit(null)}
        />
      )}

      {tab === 'struktur' && (
        <TemplateStructureEditor
          templateId={template.id}
          schema={schema}
          onChange={setSchema}
          onFieldRename={(oldId, newId) => {
            // Mapping-Schlüssel auf neue ID umbenennen — sowohl flache Keys
            // als auch Sub-Field-Keys (z.B. "adresse.strasse" → "rechnung.strasse").
            setPdfs((prev) => prev.map((p) => {
              const m = p.field_mapping ?? {};
              const next: typeof m = {};
              let changed = false;
              for (const [key, entry] of Object.entries(m)) {
                if (key === oldId) {
                  next[newId] = entry; changed = true;
                } else if (key.startsWith(oldId + '.')) {
                  next[newId + key.slice(oldId.length)] = entry; changed = true;
                } else {
                  next[key] = entry;
                }
              }
              return changed ? { ...p, field_mapping: next } : p;
            }));
          }}
        />
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
            placeholders={placeholderTokens}
            canAdd={true}
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

      {tab === 'email' && (
        <TemplateEmailEditor
          config={emailConfig}
          onChange={setEmailConfig}
          pdfs={pdfs}
          placeholders={placeholderTokens}
        />
      )}

      {tab === 'freigabe' && template && (
        <TemplateFreigabeEditor templateId={template.id} />
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
  pdfs, activeId, onSelect, onRename, onDelete, onAdd, onPatternChange, placeholders, canAdd,
}: {
  pdfs: TemplatePdf[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (pdf: TemplatePdf) => void;
  onAdd: () => void;
  onPatternChange: (id: string, pattern: string) => void;
  placeholders: PlaceholderToken[];
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
            placeholders={placeholders}
          />
        </div>
      )}
    </div>
  );
}

function FilenamePatternRow({
  value, onChange, fallback, placeholders,
}: {
  value: string;
  onChange: (v: string) => void;
  fallback: string;
  placeholders: PlaceholderToken[];
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
        beim Generieren durch die Werte aus dem Formular ersetzt. Bei zusammen-
        gesetzten Feldern (z.B. Adresse) sind auch Sub-Felder möglich, etc.
        {' '}<code className="rounded bg-maja-light px-1">{'{adresse.stadt}'}</code>.
        Sonderzeichen (Leerzeichen, Schrägstriche) werden durch „_" ersetzt.
      </p>
      {placeholders.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-maja-accent hover:underline">
            Verfügbare Platzhalter ({placeholders.length}) anzeigen
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {placeholders.map((p) => (
              <button
                key={p.token}
                type="button"
                onClick={() => onChange((value || '') + p.token)}
                title="In Pattern einfügen"
                className="rounded-full bg-maja-light px-2 py-0.5 text-[11px] text-maja-navy hover:bg-maja-accent/20"
              >
                {p.token}
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
