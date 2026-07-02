import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/Spinner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CheckIcon } from '../components/icons';
import { FormRenderer } from '../components/forms/FormRenderer';
import { PdfPreviewModal } from '../components/forms/PdfPreviewModal';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { pageCompletion, validateForm } from '../lib/validateForm';
import { effectivePages, sectionsForPage } from '../lib/formPages';
import { collectPageImageBlobs, countPageImages, sharePhotos } from '../lib/sharePagePhotos';
import { deleteFormPdf } from '../lib/pdfGenerate';
import { buildFormularFolder } from '../lib/onedrivePaths';
import { runSubmissionEmails, readSliderState, sliderKey } from '../lib/submissionEmails';
import {
  deleteFormDraft, enqueueSubmission, getFormDraft, getUploadsForFormular,
  saveFormDraft,
} from '../lib/offlineDb';
import { useAuth } from '../auth/AuthContext';
import { useTestGuard } from '../auth/TestModeContext';
import { useSync } from '../sync/SyncContext';
import { displayName } from '../lib/names';
import type {
  AusgefuelltesFormular, FormSchema, FormularTemplate,
} from '../types/db';
import type { Json } from '../types/supabase';

function parseTime(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

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

const REDIRECT_AFTER_SUBMIT_MS = 3000;

export function FormularPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formular, setFormular] = useState<AusgefuelltesFormular | null>(null);
  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'draft' | 'submit'>('idle');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Kurzer Auto-Save-Hinweis ("Automatisch gespeichert"), verschwindet nach 3s.
  const [autoSaveHint, setAutoSaveHint] = useState<string | null>(null);
  const { triggerSync } = useSync();
  const { session, profile } = useAuth();
  const guard = useTestGuard();
  // E-Mail des aktuell eingeloggten Nutzers — bekommt automatisch eine
  // Kopie jeder Submission als CC.
  const submitterEmail = session?.user?.email ?? null;

  // ---- Dirty-Tracking + Unsaved-Warnung ----
  const [savedDataJson, setSavedDataJson] = useState<string>('{}');
  const dirty = useMemo(() => {
    if (formular?.status === 'submitted') return false;
    return JSON.stringify(data) !== savedDataJson;
  }, [data, savedDataJson, formular?.status]);
  // pendingExit: gewünschtes Ziel für die Navigation, das auf Bestätigung wartet.
  const [pendingExit, setPendingExit] = useState<string | null>(null);

  // ---- Submit-Erfolg + Auto-Redirect ----
  const [submittedSummary, setSubmittedSummary] = useState<string | null>(null);
  const [redirectIn, setRedirectIn] = useState<number>(0);
  const redirectTimerRef = useRef<number | null>(null);

  // ---- PDF-Vorschau ----
  const [previewOpen, setPreviewOpen] = useState(false);

  // ---- Browser-Level: beforeunload-Warnung bei dirty ----
  useEffect(() => {
    if (!dirty || saving === 'submit') return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome erfordert das setzen von returnValue; Text wird ignoriert.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, saving]);

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
      if (afErr) { setError(`Formular konnte nicht geladen werden: ${afErr.message}`); setLoading(false); return; }
      if (!af) { setError('Formular nicht gefunden oder du hast keinen Zugriff darauf.'); setLoading(false); return; }

      const { data: tpl, error: tplErr } = await supabase
        .from('formular_templates')
        .select('*')
        .eq('id', af.template_id)
        .maybeSingle();
      if (cancelled) return;
      if (tplErr) { setError(`Template konnte nicht geladen werden: ${tplErr.message}`); setLoading(false); return; }
      if (!tpl) {
        setError('Das verknüpfte Template wurde nicht gefunden.');
        setLoading(false);
        return;
      }

      const schema = parseSchema(tpl.schema);
      const normalizedTpl = { ...tpl, schema } as unknown as FormularTemplate;
      setFormular(af as unknown as AusgefuelltesFormular);
      setTemplate(normalizedTpl);

      // Lokalen Entwurf aus IndexedDB einlesen. Wenn er neuer ist als der
      // Server-Stand (oder der Server gar kein updated_at hat), nehmen wir
      // den lokalen Stand — der Fahrer hat zuletzt daran gearbeitet.
      const serverData = (af.daten as unknown as Record<string, unknown>) ?? {};
      const serverTime = parseTime(af.created_at);
      let nextData = serverData;
      let restoredFromLocal = false;
      try {
        const local = await getFormDraft(af.id);
        if (local && local.savedAt > serverTime) {
          nextData = local.data;
          restoredFromLocal = true;
        }
      } catch (err) {
        console.warn('[FormularPage] IDB-Lesen fehlgeschlagen', err);
      }
      // Legacy: alten sessionStorage-Eintrag — falls vorhanden — räumen.
      try { sessionStorage.removeItem(`formular-draft-${af.id}`); } catch { /* ignore */ }

      // Vorausgefüllte Daten der verknüpften Tour (sofern bekannt) mergen.
      // Felder, die der Fahrer schon angefasst hat (_touched), bleiben.
      const tourId = typeof nextData._tour_id === 'string' ? nextData._tour_id : null;
      if (tourId) {
        try {
          const { data: tour } = await supabase
            .from('touren')
            .select('vorgefuellte_daten')
            .eq('id', tourId)
            .maybeSingle();
          const prefill = tour?.vorgefuellte_daten as Record<string, unknown> | null;
          if (prefill && typeof prefill === 'object') {
            const touched = (nextData._touched && typeof nextData._touched === 'object')
              ? nextData._touched as Record<string, unknown>
              : {};
            const merged: Record<string, unknown> = { ...nextData };
            for (const [k, v] of Object.entries(prefill)) {
              if (!touched[k]) merged[k] = v;
            }
            nextData = merged;
          }
        } catch (err) {
          console.warn('[FormularPage] Prefill-Refresh fehlgeschlagen', err);
        }
      }

      setData(nextData);
      // Saved-State spiegelt das, was tatsächlich in der DB liegt.
      setSavedDataJson(JSON.stringify(serverData));
      setLoading(false);
      if (restoredFromLocal) {
        setAutoSaveHint('Daten wiederhergestellt');
        window.setTimeout(() => setAutoSaveHint((h) => h === 'Daten wiederhergestellt' ? null : h), 3000);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const readonly = formular?.status === 'submitted';

  const handleChange = useCallback((fieldId: string, value: unknown) => {
    setData((prev) => {
      const next = { ...prev, [fieldId]: value };
      // Felder, die der Fahrer aktiv geändert hat, merken — damit
      // nachgelagerte Admin-Prefill-Updates sie nicht überschreiben.
      // Reserved-Keys (z.B. `_slider_0`, `_tour_id`, `_touched`) sind
      // intern und werden NICHT als Fahrer-Touch markiert.
      if (!fieldId.startsWith('_')) {
        const touched = (prev._touched && typeof prev._touched === 'object')
          ? prev._touched as Record<string, unknown>
          : {};
        next._touched = { ...touched, [fieldId]: true };
      }
      return next;
    });
  }, []);

  // Auto-Save: debounced 2 s nach der letzten Änderung in IndexedDB.
  // Damit gehen Daten bei App-Wechsel / schwarzem Bildschirm nicht verloren.
  const autoSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!formular || readonly) return;
    if (!dirty) return; // nichts zu sichern
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      void saveFormDraft({
        id: formular.id,
        data,
        serverUpdatedAt: formular.created_at ?? null,
        savedAt: Date.now(),
      }).then(() => {
        setAutoSaveHint('Automatisch gespeichert');
        window.setTimeout(() => setAutoSaveHint((h) => h === 'Automatisch gespeichert' ? null : h), 3000);
      }).catch((err) => {
        console.warn('[FormularPage] Auto-Save fehlgeschlagen', err);
      });
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  // formular?.updated_at sich zu merken ist OK — verhindert Stale-Closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dirty, readonly, formular?.id]);

  // Wenn der Sync-Drainer einen Upload abgeschlossen hat, ist der Entwurf
  // in IDB jetzt aktueller (Photo-Feld zeigt jetzt storage_path). Wir laden
  // den Stand neu und übernehmen ihn ins UI.
  useEffect(() => {
    if (!formular) return;
    function handler(e: Event) {
      const ev = e as CustomEvent<{ formularId: string }>;
      if (ev.detail?.formularId !== formular?.id) return;
      void getFormDraft(formular!.id).then((d) => {
        if (d) setData(d.data);
      });
    }
    window.addEventListener('maja:draft-updated', handler as EventListener);
    return () => window.removeEventListener('maja:draft-updated', handler as EventListener);
  }, [formular]);

  async function clearLocalDraft() {
    if (!id) return;
    try { await deleteFormDraft(id); } catch { /* ignore */ }
  }

  async function saveDraft(): Promise<void> {
    if (!formular) return;
    if (guard()) return;
    setSaving('draft');
    setStatusMsg(null);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data as Json })
      .eq('id', formular.id);
    setSaving('idle');
    if (err) { setError(err.message); throw new Error(err.message); }
    await clearLocalDraft();
    setStatusMsg('Entwurf gespeichert.');
    setSavedDataJson(JSON.stringify(data));
  }

  async function submit() {
    if (!formular || !template) return;
    if (guard()) return;
    const { valid, missing } = validateForm(template.schema, data);
    if (!valid) {
      setError(`Bitte fülle die Pflichtfelder aus: ${missing.join(', ')}`);
      return;
    }
    setSaving('submit');
    setError(null);

    // Wenn offline ODER noch Photo-Uploads anhängig sind: in IDB als
    // pending-submission ablegen und User informieren. Der Sync-Drainer
    // reicht das Formular nach, sobald wieder Empfang da ist und die
    // Upload-Queue für dieses Formular leer ist.
    const pendingUploads = await getUploadsForFormular(formular.id).catch(() => []);
    if (!navigator.onLine || pendingUploads.length > 0) {
      await enqueueSubmission({
        formularId: formular.id,
        data,
        queuedAt: Date.now(),
        attempts: 0,
        lastError: null,
        submitterEmail,
      });
      // Den Entwurf NICHT löschen — falls noch Edits nötig werden.
      await saveFormDraft({
        id: formular.id, data,
        serverUpdatedAt: formular.created_at ?? null,
        savedAt: Date.now(),
      });
      setSaving('idle');
      triggerSync();
      const n = pendingUploads.length;
      setSubmittedSummary(
        navigator.onLine
          ? (n > 0
              ? `Formular gespeichert — ${n} ${n === 1 ? 'Bild ist' : 'Bilder sind'} noch nicht hochgeladen. Es wird automatisch eingereicht, sobald alle Bilder hochgeladen sind.`
              : 'Formular gespeichert — wird automatisch eingereicht.')
          : 'Formular gespeichert — wird automatisch eingereicht, sobald du wieder online bist.',
      );
      setRedirectIn(REDIRECT_AFTER_SUBMIT_MS);
      if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = window.setTimeout(() => navigate('/touren'), REDIRECT_AFTER_SUBMIT_MS);
      return;
    }

    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data as Json, status: 'submitted' })
      .eq('id', formular.id);
    if (err) {
      // Netzwerk-Fehler trotz online=true → wie Offline behandeln.
      await enqueueSubmission({
        formularId: formular.id, data, queuedAt: Date.now(), attempts: 0,
        lastError: err.message, submitterEmail,
      });
      await saveFormDraft({
        id: formular.id, data,
        serverUpdatedAt: formular.created_at ?? null,
        savedAt: Date.now(),
      });
      setSaving('idle');
      triggerSync();
      setSubmittedSummary('Formular gespeichert — wird automatisch eingereicht, sobald die Verbindung wieder funktioniert.');
      setRedirectIn(REDIRECT_AFTER_SUBMIT_MS);
      if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = window.setTimeout(() => navigate('/touren'), REDIRECT_AFTER_SUBMIT_MS);
      return;
    }
    await clearLocalDraft();
    const submitted = { ...formular, daten: data, status: 'submitted' as const };
    setFormular(submitted);
    setSavedDataJson(JSON.stringify(data));
    setStatusMsg('Formular wird eingereicht …');

    // Eventuell hinterlegtes Zwischenprotokoll aufräumen — bei manueller
    // PDF-Generierung in Eingänge werden neue PDFs erzeugt; der Entwurf
    // hat ausgedient.
    const formularAny = formular as unknown as { zwischenprotokoll_url?: string | null };
    if (formularAny.zwischenprotokoll_url) {
      try {
        await deleteFormPdf(formularAny.zwischenprotokoll_url, formular.id);
        await supabase.from('ausgefuellte_formulare').update({
          zwischenprotokoll_url: null,
          zwischenprotokoll_erstellt_am: null,
        }).eq('id', formular.id);
      } catch (cleanupErr) {
        console.warn('[FormularPage] Zwischenprotokoll-Aufräumen fehlgeschlagen', cleanupErr);
      }
    }

    // Automatische E-Mails (Bestätigung + Schieberegler) — Fehler hier
    // brechen den Submit NICHT ab, sondern landen im email_send_log.
    // Zusätzlicher try/catch: selbst ein unerwarteter Crash der Routine
    // darf die (bereits persistierte) Einreichung nicht kippen.
    const fahrerName = profile ? displayName(profile) : null;
    let log: Awaited<ReturnType<typeof runSubmissionEmails>> = [];
    try {
      log = await runSubmissionEmails(template, submitted, {
        submitterEmail,
        fahrerEmail: submitterEmail, // Fahrer-Profil-Mail = eingeloggte Mail
        fahrerName,
      });
    } catch (mailErr) {
      console.warn('[Einreichung] Versand-Routine unerwartet fehlgeschlagen', mailErr);
      log = [{
        type: 'confirmation', recipients: [],
        sent_at: new Date().toISOString(), success: false,
        error: mailErr instanceof Error ? mailErr.message : String(mailErr),
      }];
    }
    setSaving('idle');
    setStatusMsg(null);

    const failed = log.filter((l) => !l.success);
    let summary = 'Formular wurde eingereicht.';
    if (failed.length > 0) {
      const addrs = failed.flatMap((l) => l.recipients).filter(Boolean).join(', ');
      summary += addrs
        ? ` E-Mail an ${addrs} konnte nicht versendet werden. `
        : ` ${failed.length} automatische E-Mail(s) konnten nicht versendet werden. `;
      summary += 'Die PDFs können über Eingänge manuell generiert und versendet werden.';
    }
    setSubmittedSummary(summary);
    // Auto-Redirect: 3-Sekunden-Countdown.
    setRedirectIn(REDIRECT_AFTER_SUBMIT_MS);
    if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = window.setTimeout(() => {
      navigate('/touren');
    }, REDIRECT_AFTER_SUBMIT_MS);
  }

  function goNow() {
    if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
    navigate('/touren');
  }

  // Aufräumen, falls der User per Zurück-Button aussteigt während der Timer läuft.
  useEffect(() => () => {
    if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
  }, []);

  /**
   * Sicherer Navigations-Wrapper: zeigt bei dirty-State den Unsaved-Dialog
   * und merkt sich die Ziel-URL als pendingExit. Wird vom Zurück-Button
   * und von In-Page-Links aufgerufen.
   */
  function safeNavigate(path: string) {
    if (dirty && saving !== 'submit') {
      setPendingExit(path);
      return;
    }
    navigate(path);
  }

  const title = useMemo(() => template?.name ?? 'Formular', [template]);
  const sectionCount = template?.schema.sections.length ?? 0;

  const oneDriveFolder = useMemo(() => {
    if (!template || !formular) return '';
    const isoDate = formular.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const kennzeichen = (data.kennzeichen ?? data.Kennzeichen ?? '') as string;
    return buildFormularFolder({
      date: isoDate,
      kennzeichen: typeof kennzeichen === 'string' ? kennzeichen : null,
      templateName: template.name,
      formularId: formular.id,
    });
  }, [template, formular, data]);

  const pages = useMemo(
    () => (template ? effectivePages(template.schema) : []),
    [template],
  );
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
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
  // „Fotos dieser Seite sichern" (Web Share API) — Anzahl erfasster
  // Bilder auf der aktuellen Seite (leere Felder zählen nicht).
  const pageImageCount = useMemo(
    () => countPageImages(visibleSections, data),
    [visibleSections, data],
  );
  const [sharingPhotos, setSharingPhotos] = useState(false);
  async function handleSharePagePhotos() {
    if (!formular) return;
    setSharingPhotos(true);
    try {
      const blobs = await collectPageImageBlobs(visibleSections, data, formular.id);
      const res = await sharePhotos(blobs);
      if (res === 'none') setAutoSaveHint('Keine Fotos auf dieser Seite.');
      else if (res === 'downloaded') setAutoSaveHint('Fotos heruntergeladen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotos konnten nicht gesichert werden.');
    } finally {
      setSharingPhotos(false);
    }
  }
  // Auf dem letzten (Abschluss-)Tab wird "Endgültig abschließen" primär
  // hervorgehoben, sonst "Speichern und später fortfahren". Greift
  // automatisch für jedes Template — der letzte Tab ist immer der Abschluss.
  const isLastPage = pages.length === 0 || currentPageIdx >= pages.length - 1;

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
      <button onClick={() => safeNavigate('/')} className="btn-secondary">← Zurück</button>
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
        </div>
      </div>
    );
  }

  if (!formular || !template) {
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="card p-6 text-sm text-maja-muted">
          Unerwarteter Zustand — bitte erneut laden.
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
            Dieses Template enthält noch keine Sektionen oder Felder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* Submit-Erfolgsbanner mit Auto-Redirect-Countdown */}
      {submittedSummary && (
        <div role="status" className="card border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-medium">{submittedSummary}</div>
          <p className="mt-1 text-xs text-emerald-800">
            Du wirst automatisch zur Tourenliste weitergeleitet …
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={goNow} className="btn-primary text-sm">
              Jetzt zur Tourenliste
            </button>
            <button type="button" onClick={() => {
              if (redirectTimerRef.current != null) window.clearTimeout(redirectTimerRef.current);
              setRedirectIn(0);
              setSubmittedSummary(null);
            }} className="btn-secondary text-sm">
              Hier bleiben
            </button>
          </div>
        </div>
      )}
      {void redirectIn /* nur Re-Render-Trigger */}

      {hasMultiplePages && (
        <div className="sticky top-0 z-10 -mx-4 border-b border-maja-navy/10 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <nav className="flex gap-1 overflow-x-auto">
            {pages.map((p) => {
              const status = pageCompletion(p, template.schema.sections ?? [], data);
              const active = p.id === currentPage?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCurrentPageId(p.id)}
                  className={
                    'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition '
                    + (active
                      ? 'bg-maja-navy text-white'
                      : 'bg-maja-light text-maja-navy hover:bg-maja-light/70 '
                        + 'dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600')
                  }
                  aria-current={active ? 'page' : undefined}
                >
                  {status === 'complete' ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                  ) : status === 'started' ? (
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                  ) : null}
                  {p.title}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {pageImageCount > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-maja-muted">
            Öffnet das Teilen-Menü — wähle „In Fotos sichern", um die Bilder
            im Album zu speichern.
          </span>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => void handleSharePagePhotos()}
            disabled={sharingPhotos}
            title="Alle Fotos dieser Seite über das native Teilen-Menü sichern"
          >
            {sharingPhotos ? 'Wird vorbereitet …' : `Fotos dieser Seite sichern (${pageImageCount})`}
          </button>
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
              Ein unerwarteter Fehler ist aufgetreten.
            </p>
            <pre className="overflow-auto rounded bg-red-50 p-3 text-xs text-red-900">
              {error.message}
            </pre>
            <div className="flex gap-2">
              <button onClick={reset} className="btn-secondary">Erneut versuchen</button>
              <button onClick={() => safeNavigate('/')} className="btn-primary">Zurück</button>
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
          oneDriveFolder={oneDriveFolder}
          formularId={formular.id}
        />
      </ErrorBoundary>

      {isLastPage && template.email_config?.sliders?.enabled && (
        <SlidersSection
          config={template.email_config.sliders}
          data={data}
          onChange={handleChange}
          disabled={readonly}
        />
      )}

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
      {autoSaveHint && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-maja-navy/90 px-3 py-1 text-xs font-medium text-white shadow">
          {autoSaveHint}
        </div>
      )}

      {!readonly && !submittedSummary && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 bg-white/90 px-4 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="btn-secondary"
            disabled={saving !== 'idle'}
            title="Vorschau der gefüllten PDF anzeigen"
          >
            PDF-Vorschau
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void saveDraft().catch(() => {})}
              className={isLastPage ? 'btn-secondary' : 'btn-primary'}
              disabled={saving !== 'idle'}
            >
              {saving === 'draft' ? 'Speichern …' : 'Speichern und später fortfahren'}
            </button>
            <button
              onClick={submit}
              className={isLastPage ? 'btn-primary' : 'btn-secondary'}
              disabled={saving !== 'idle'}
            >
              {saving === 'submit' ? 'Wird abgeschlossen …' : 'Endgültig abschließen'}
            </button>
          </div>
        </div>
      )}

      {pendingExit !== null && (
        <UnsavedChangesDialog
          onSave={async () => { await saveDraft(); }}
          onLeave={() => { const target = pendingExit; setPendingExit(null); if (target) navigate(target); }}
          onCancel={() => setPendingExit(null)}
        />
      )}

      {previewOpen && (
        <PdfPreviewModal
          template={template}
          data={data}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Schieberegler-Block — wird beim letzten Tab gerendert, wenn das Template
 * E-Mail 2 aktiviert hat. Pro Schieberegler ein Toggle + ein E-Mail-Input.
 * Werte werden unter den Reserved-Keys `_slider_0` / `_slider_1` in
 * `daten` abgelegt (siehe `submissionEmails.ts`).
 */
function SlidersSection({
  config, data, onChange, disabled,
}: {
  config: NonNullable<import('../types/db').EmailConfig['sliders']>;
  data: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const indexes: (0 | 1)[] = config.count === 2 ? [0, 1] : [0];
  return (
    <section className="card space-y-4 p-6">
      <h2 className="text-lg font-semibold text-maja-navy">Protokoll versenden</h2>
      <p className="text-xs text-maja-muted">
        Aktiviere den Schieberegler, wenn das Protokoll nach dem Abschluss an
        eine zusätzliche Adresse versendet werden soll.
      </p>
      <div className="space-y-4">
        {indexes.map((i) => (
          <SliderRow
            key={i}
            label={config.labels[i] || `Schieberegler ${i + 1}`}
            stateKey={sliderKey(i)}
            data={data}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

function SliderRow({
  label, stateKey, data, onChange, disabled,
}: {
  label: string;
  stateKey: string;
  data: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const idx = stateKey === '_slider_0' ? 0 : 1;
  const state = readSliderState(data, idx);
  const invalid = state.enabled && state.email.trim() !== '' && !EMAIL_RE.test(state.email.trim());

  function toggle(next: boolean) {
    onChange(stateKey, { enabled: next, email: state.email });
  }
  function setEmail(v: string) {
    onChange(stateKey, { enabled: state.enabled, email: v });
  }

  return (
    <div className="space-y-2 rounded-lg border border-maja-navy/10 p-3">
      <label className="flex items-center gap-3 text-sm">
        <span
          role="switch"
          aria-checked={state.enabled}
          tabIndex={disabled ? -1 : 0}
          onClick={() => { if (!disabled) toggle(!state.enabled); }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(!state.enabled); }
          }}
          className={
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition '
            + (state.enabled
              ? 'bg-maja-accent border-maja-accent dark:bg-blue-500 dark:border-blue-400'
              : 'bg-maja-navy/20 border-maja-navy/30 dark:bg-slate-600 dark:border-slate-500')
            + (disabled ? ' opacity-50 cursor-not-allowed' : '')
          }
        >
          <span
            className={
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition '
              + (state.enabled ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </span>
        <span className="font-medium text-maja-ink">{label}</span>
      </label>

      {state.enabled && (
        <div>
          <label htmlFor={`${stateKey}-email`} className="label">
            E-Mail-Adresse
          </label>
          <input
            id={`${stateKey}-email`}
            type="email"
            className="input"
            value={state.email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="z.B. kunde@example.com"
            disabled={disabled}
          />
          {invalid && (
            <p className="mt-1 text-xs text-amber-700">
              Bitte eine gültige E-Mail-Adresse eingeben — sonst geht keine
              Nachricht raus.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
