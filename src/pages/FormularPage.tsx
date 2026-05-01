import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { FormRenderer } from '../components/forms/FormRenderer';
import { pageCompletion, validateForm } from '../lib/validateForm';
import { effectivePages, sectionsForPage } from '../lib/formPages';
import { generateAndUploadFormPdfs } from '../lib/pdfGenerate';
import type { AusgefuelltesFormular, FormSchema, FormularTemplate } from '../types/db';
import type { Json } from '../types/supabase';

/**
 * Normalisiert das schema-JSON aus der DB. Akzeptiert Object oder String, gibt
 * immer ein Schema mit (mindestens leerem) sections-Array zurück.
 */
function parseSchema(raw: unknown): FormSchema {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (value && typeof value === 'object' && Array.isArray((value as { sections?: unknown }).sections)) {
    return value as FormSchema;
  }
  return { sections: [] };
}

export function FormularPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [formular, setFormular] = useState<AusgefuelltesFormular | null>(null);
  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'draft' | 'submit'>('idle');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError('Keine Formular-ID in der URL.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const { data: af, error: afErr } = await supabase
        .from('ausgefuellte_formulare')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (afErr) {
        console.error('FormularPage: Fehler beim Laden des Formulars', afErr);
        setError(`Formular konnte nicht geladen werden: ${afErr.message}`);
        setLoading(false);
        return;
      }
      if (!af) {
        setError('Formular nicht gefunden oder du hast keinen Zugriff darauf.');
        setLoading(false);
        return;
      }

      const { data: tpl, error: tplErr } = await supabase
        .from('formular_templates')
        .select('*')
        .eq('id', af.template_id)
        .maybeSingle();
      if (cancelled) return;
      if (tplErr) {
        console.error('FormularPage: Fehler beim Laden des Templates', tplErr);
        setError(`Template konnte nicht geladen werden: ${tplErr.message}`);
        setLoading(false);
        return;
      }
      if (!tpl) {
        setError(
          'Das verknüpfte Template wurde nicht gefunden. Es wurde möglicherweise gelöscht ' +
          'oder du hast keine Zuweisung. Bitte wende dich an die Administration.',
        );
        setLoading(false);
        return;
      }

      const schema = parseSchema(tpl.schema);
      const normalizedTpl = {
        ...tpl,
        schema,
      } as unknown as FormularTemplate;

      // Debug-Ausgabe (im Browser sichtbar) — hilft beim Diagnostizieren leerer Templates.
      console.log('[FormularPage] Formular geladen:', af);
      console.log('[FormularPage] Template geladen:', normalizedTpl);
      console.log(
        '[FormularPage] Schema-Sections:',
        schema.sections.length,
        'Felder gesamt:',
        schema.sections.reduce((acc, s) => acc + (s.fields?.length ?? 0), 0),
      );

      setFormular(af as unknown as AusgefuelltesFormular);
      setTemplate(normalizedTpl);

      // Wenn der Browser nach Foto-Aufnahme die Seite neu lädt (mobile Tab-Recycling),
      // sind unsere lokalen Eingaben noch nicht in der DB. sessionStorage rettet sie.
      const localKey = `formular-draft-${af.id}`;
      let nextData = (af.daten as unknown as Record<string, unknown>) ?? {};
      try {
        const cached = sessionStorage.getItem(localKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object') {
            nextData = { ...nextData, ...parsed };
            console.log('[FormularPage] sessionStorage-Snapshot wiederhergestellt');
          }
        }
      } catch (err) {
        console.warn('[FormularPage] sessionStorage-Lesen fehlgeschlagen', err);
      }
      setData(nextData);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const readonly = formular?.status === 'submitted';

  const handleChange = useCallback((fieldId: string, value: unknown) => {
    setData((prev) => {
      const next = { ...prev, [fieldId]: value };
      // Sofort lokal persistieren, damit ein Reload (z.B. nach Foto-Aufnahme)
      // den eingegebenen Stand nicht verliert.
      if (id) {
        try {
          sessionStorage.setItem(`formular-draft-${id}`, JSON.stringify(next));
        } catch {/* QuotaExceeded etc. ignorieren */}
      }
      return next;
    });
  }, [id]);

  function clearLocalDraft() {
    if (!id) return;
    try { sessionStorage.removeItem(`formular-draft-${id}`); } catch {/* ignore */}
  }

  async function saveDraft() {
    if (!formular) return;
    setSaving('draft');
    setStatusMsg(null);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data as Json })
      .eq('id', formular.id);
    setSaving('idle');
    if (err) { setError(err.message); return; }
    clearLocalDraft();
    setStatusMsg('Entwurf gespeichert.');
  }

  async function submit() {
    if (!formular || !template) return;
    const { valid, missing } = validateForm(template.schema, data);
    if (!valid) {
      setError(`Bitte fülle die Pflichtfelder aus: ${missing.join(', ')}`);
      return;
    }
    setSaving('submit');
    setError(null);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data as Json, status: 'submitted' })
      .eq('id', formular.id);
    setSaving('idle');
    if (err) { setError(err.message); return; }
    clearLocalDraft();
    const submitted = { ...formular, daten: data, status: 'submitted' as const };
    setFormular(submitted);
    setStatusMsg('Protokoll eingereicht. PDFs werden erzeugt …');

    // PDFs nach Submit generieren — läuft async, blockiert die UI nicht.
    if (session) {
      try {
        const paths = await generateAndUploadFormPdfs(template, submitted, session.user.id);
        setStatusMsg(
          paths.length > 0
            ? `Protokoll eingereicht. ${paths.length} PDF${paths.length === 1 ? '' : 's'} erzeugt.`
            : 'Protokoll eingereicht. (Keine PDF-Vorlagen am Template hinterlegt.)',
        );
      } catch (err) {
        console.warn('[FormularPage] PDF-Erzeugung fehlgeschlagen', err);
        setStatusMsg('Protokoll eingereicht. PDF-Erzeugung schlug fehl — siehe Konsole.');
      }
    }
  }

  const userId = session?.user.id ?? '';
  const title = useMemo(() => template?.name ?? 'Formular', [template]);
  const sectionCount = template?.schema.sections.length ?? 0;

  const pages = useMemo(
    () => (template ? effectivePages(template.schema) : []),
    [template],
  );
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  // Beim ersten Laden / Wechsel des Templates die erste Seite aktiv setzen
  useEffect(() => {
    if (!currentPageId && pages.length > 0) setCurrentPageId(pages[0].id);
  }, [pages, currentPageId]);
  const currentPage = pages.find((p) => p.id === currentPageId) ?? pages[0] ?? null;
  const visibleSections = useMemo(
    () => (template && currentPage ? sectionsForPage(template.schema, currentPage) : []),
    [template, currentPage],
  );
  const currentPageIdx = currentPage ? pages.findIndex((p) => p.id === currentPage.id) : 0;
  const hasMultiplePages = pages.length > 1;

  // Header mit Zurück-Button — IMMER sichtbar, unabhängig vom Lade-/Fehler-Zustand.
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">{title}</h1>
        {formular && (
          <p className="text-sm text-maja-muted">
            Status: {readonly ? 'eingereicht' : 'Entwurf'} · Erstellt am{' '}
            {new Date(formular.created_at).toLocaleString('de-DE')}
          </p>
        )}
      </div>
      <button onClick={() => navigate('/')} className="btn-secondary">← Zurück</button>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <Spinner label="Formular wird geladen …" />
      </div>
    );
  }

  if (error && (!formular || !template)) {
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="card space-y-3 p-6">
          <h2 className="text-lg font-semibold text-red-700">Formular konnte nicht geöffnet werden</h2>
          <p className="text-sm text-maja-ink">{error}</p>
          <p className="text-xs text-maja-muted">
            Diagnose-Hinweise stehen in der Browser-Konsole (Rechtsklick → Untersuchen → Console).
          </p>
        </div>
      </div>
    );
  }

  if (!formular || !template) {
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="card p-6 text-sm text-maja-muted">
          Unerwarteter Zustand — weder Formular noch Template geladen, aber kein Fehler gemeldet.
          Bitte erneut laden.
        </div>
      </div>
    );
  }

  if (sectionCount === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card space-y-2 p-6">
          <h2 className="text-lg font-semibold text-maja-navy">Leeres Template</h2>
          <p className="text-sm text-maja-muted">
            Dieses Template enthält noch keine Sektionen oder Felder. Bitte den Admin
            bitten, das Template unter „Templates → Bearbeiten" mit Inhalt zu füllen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {hasMultiplePages && (
        <div className="sticky top-0 z-10 -mx-4 border-b border-maja-navy/10 bg-white/95 px-4 py-2 backdrop-blur">
          <nav className="flex gap-1 overflow-x-auto">
            {pages.map((p) => {
              const status = pageCompletion(
                p, template.schema.sections ?? [], data,
              );
              const active = p.id === currentPage?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCurrentPageId(p.id)}
                  className={
                    'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ' +
                    (active
                      ? 'bg-maja-navy text-white'
                      : 'bg-maja-light text-maja-navy hover:bg-maja-light/70')
                  }
                  aria-current={active ? 'page' : undefined}
                >
                  {status === 'complete' ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white" aria-label="vollständig">✓</span>
                  ) : status === 'started' ? (
                    <span className="h-2 w-2 rounded-full bg-amber-400" aria-label="angefangen" />
                  ) : null}
                  {p.title}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      <ErrorBoundary
        resetKey={`${formular.id}::${currentPage?.id ?? ''}`}
        fallback={({ error, reset }) => (
          <div role="alert" className="card space-y-3 p-6">
            <h2 className="text-lg font-semibold text-red-700">
              Fehler beim Rendern des Formulars
            </h2>
            <p className="text-sm text-maja-ink">
              Ein unerwarteter Fehler ist im Formular-Renderer aufgetreten. Die App
              läuft weiter — du kannst zurück zur Übersicht oder erneut versuchen.
            </p>
            <pre className="overflow-auto rounded bg-red-50 p-3 text-xs text-red-900">
              {error.message}
            </pre>
            <p className="text-xs text-maja-muted">
              Details und Stack stehen in der Browser-Konsole.
            </p>
            <div className="flex gap-2">
              <button onClick={reset} className="btn-secondary">Erneut versuchen</button>
              <button onClick={() => navigate('/')} className="btn-primary">Zurück</button>
            </div>
          </div>
        )}
      >
        <FormRenderer
          schema={template.schema}
          sections={visibleSections}
          data={data}
          onChange={handleChange}
          disabled={readonly}
          userId={userId}
          formularId={formular.id}
        />
      </ErrorBoundary>

      {hasMultiplePages && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-maja-navy/10 pt-3">
          <button
            type="button"
            onClick={() => {
              const prev = pages[currentPageIdx - 1];
              if (prev) {
                setCurrentPageId(prev.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="btn-secondary"
            disabled={currentPageIdx <= 0}
          >
            ← Vorherige Seite
          </button>
          <button
            type="button"
            onClick={() => {
              const next = pages[currentPageIdx + 1];
              if (next) {
                setCurrentPageId(next.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="btn-secondary"
            disabled={currentPageIdx >= pages.length - 1}
          >
            Nächste Seite →
          </button>
        </div>
      )}

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

      {!readonly && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-maja-navy/10 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={saveDraft} className="btn-secondary" disabled={saving !== 'idle'}>
            {saving === 'draft' ? 'Speichern …' : 'Entwurf speichern'}
          </button>
          <button onClick={submit} className="btn-primary" disabled={saving !== 'idle'}>
            {saving === 'submit' ? 'Einreichen …' : 'Einreichen'}
          </button>
        </div>
      )}
    </div>
  );
}
