import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/Spinner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CheckIcon } from '../components/icons';
import { FormRenderer } from '../components/forms/FormRenderer';
import { PdfPreviewModal } from '../components/forms/PdfPreviewModal';
import { FormularAktionsleiste } from '../components/FormularAktionsleiste';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { pageCompletion, validateForm } from '../lib/validateForm';
import { effectivePages, sectionsForPage } from '../lib/formPages';
import { collectPageImageBlobs, countPageImages, sharePhotos } from '../lib/sharePagePhotos';
import {
  generateAndUploadZwischenprotokoll, zwischenprotokollPdfIds,
} from '../lib/pdfGenerate';
import { buildFormularFolder } from '../lib/onedrivePaths';
import {
  appendEmailLog, runSubmissionEmails, runZwischenprotokollEmail,
  readSliderState, sliderKey,
} from '../lib/submissionEmails';
import {
  deleteFormDraft, enqueueSubmission, getFormDraft, getUploadsForFormular,
  saveFormDraft,
} from '../lib/offlineDb';
import { useAuth } from '../auth/AuthContext';
import { useTestGuard, useTestMode } from '../auth/TestModeContext';
import { merkeAusFormular } from '../lib/feldVorschlaege';
import { tourRoute, tourZusatz } from '../lib/touren';
import { diagnose, setzeDiagnoseKontext } from '../lib/diagnose';
import { ersetzePendingFoto } from '../lib/pendingFoto';
import { entfernePendingAusDaten, istFehlgeschlagen } from '../lib/uploadQueue';
import { appModus, entwurfWaehlen, felderAnzahl, istIos, type ServerStand } from '../lib/entwurfStand';
import { saveFormDraft as lokalenEntwurfSetzen } from '../lib/offlineDb';
import { useEntwurfSync } from '../lib/useEntwurfSync';
import { EntwurfKonfliktDialog, InstallHinweis, SpeicherStatusZeile } from '../components/forms/EntwurfStatus';
import type { FeldWert } from '../components/forms/FormRenderer';
import { useSync } from '../sync/SyncContext';
import { displayName } from '../lib/names';
import type {
  AusgefuelltesFormular, FormSchema, FormularTemplate, PhotoValue,
} from '../types/db';
import type { Json } from '../types/supabase';


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
  /** Übertragenes Original, auf diesem Gerät lag noch ein ungespeicherter Stand. */
  const [lokalNichtUebernommen, setLokalNichtUebernommen] = useState(false);
  /** Tour, aus der dieses Formular stammt — nur für die Kopfzeile. */
  const [tourBezug, setTourBezug] = useState<{
    tour_id: string | null; start_stadt: string | null;
    ziel_stadt: string | null; rueckfuehrung_stadt: string | null;
    startdatum: string | null; enddatum: string | null;
  } | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'draft' | 'submit'>('idle');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Kurzer Auto-Save-Hinweis ("Automatisch gespeichert"), verschwindet nach 3s.
  const [autoSaveHint, setAutoSaveHint] = useState<string | null>(null);
  const { triggerSync, pruefen } = useSync();
  const { session, profile } = useAuth();
  /** „X Bilder konnten nicht hochgeladen werden. Trotzdem abschließen?" */
  const [fehlendeBilderFrage, setFehlendeBilderFrage] = useState<string[] | null>(null);
  const guard = useTestGuard();
  // Testmodus schreibt nichts in den Vorschlags-Pool (zusätzlich zur
  // Rollenprüfung in der RPC).
  const { isTestUser } = useTestMode();
  // E-Mail des aktuell eingeloggten Nutzers — bekommt automatisch eine
  // Kopie jeder Submission als CC.
  // Adresse für Bestätigungs-/Zwischenprotokoll-Mails: frisch aus dem
  // Profil, nicht aus der Anmeldesitzung. Ändert der Admin die Adresse,
  // trägt die laufende Sitzung bis zur nächsten Token-Erneuerung (bis zu
  // 1 h) noch die alte — die Mail ginge sonst an die alte Adresse.
  const sitzungsEmail = session?.user?.email ?? null;
  const sitzungsUserId = session?.user?.id ?? null;
  const [profilEmail, setProfilEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!sitzungsUserId) return;
    let aktiv = true;
    void supabase.from('app_users').select('email').eq('id', sitzungsUserId).maybeSingle()
      .then(({ data }) => { if (aktiv && data?.email) setProfilEmail(data.email); });
    return () => { aktiv = false; };
  }, [sitzungsUserId]);
  const submitterEmail = profilEmail ?? sitzungsEmail;

  // ---- Dirty-Tracking + Unsaved-Warnung ----
  const [savedDataJson, setSavedDataJson] = useState<string>('{}');
  const dirty = useMemo(() => {
    if (formular?.status === 'submitted') return false;
    return JSON.stringify(data) !== savedDataJson;
  }, [data, savedDataJson, formular?.status]);
  // pendingExit: gewünschtes Ziel für die Navigation, das auf Bestätigung wartet.
  const [pendingExit, setPendingExit] = useState<string | null>(null);

  // ---- Sicheres Speichern: lokal UND Server (lib/useEntwurfSync) ----
  // Server und Gerät haben beim Öffnen unterschiedliche Stände → der
  // Fahrer wählt (bis dahin wird nichts zum Server geschrieben).
  const [konflikt, setKonflikt] = useState<null | {
    server: ServerStand;
    lokal: { daten: Record<string, unknown>; savedAt: number };
  }>(null);
  const entwurfSync = useEntwurfSync({
    formularId: formular?.id ?? null,
    aktiv: !!formular && !loading && formular.status === 'draft' && !formular.uebertragen_auf_id
      && !konflikt && saving !== 'submit',
    data,
    dirty,
    onGespeichert: setSavedDataJson,
  });
  const { setServerStand, seitenwechsel: beiSeitenwechsel } = entwurfSync;

  // ---- Submit-Erfolg + Auto-Redirect ----
  const [submittedSummary, setSubmittedSummary] = useState<string | null>(null);
  const [redirectIn, setRedirectIn] = useState<number>(0);
  const redirectTimerRef = useRef<number | null>(null);

  // ---- PDF-Vorschau ----
  const [previewOpen, setPreviewOpen] = useState(false);
  const [zwischenBusy, setZwischenBusy] = useState(false);

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

      // Auf ein anderes Template übertragen (Migration 101): nur noch das
      // unveränderte Original zeigen, KEINEN lokalen Entwurf einspielen —
      // weiter geht es im neuen Formular. Lag auf diesem Gerät noch ein
      // ungespeicherter Stand, wird das angezeigt und protokolliert.
      if (af.uebertragen_auf_id) {
        try {
          const local = await getFormDraft(af.id);
          if (local && JSON.stringify(local.data) !== JSON.stringify(serverData)) {
            setLokalNichtUebernommen(true);
            diagnose('uebertragen_lokaler_entwurf', { formular: af.id, neues_formular: af.uebertragen_auf_id }, 'formular');
          }
        } catch { /* IDB nicht verfügbar */ }
        if (cancelled) return;
        setData(serverData);
        setSavedDataJson(JSON.stringify(serverData));
        setLoading(false);
        return;
      }

      // Beide Quellen laden und nach lib/entwurfStand entscheiden: ein
      // leerer oder deutlich kleinerer Stand überschreibt NIE einen
      // volleren; echte Konflikte entscheidet der Fahrer. Vorher gewann
      // der lokale Entwurf, sobald er existierte (verglichen wurde nur mit
      // dem Anlagedatum) — und fehlte er (iOS hatte den Speicher geleert),
      // blieb nur der Server-Stand vom Anlegen: leeres Protokoll.
      let nextData = serverData;
      let restoredFromLocal = false;
      const serverStand: ServerStand = {
        daten: serverData,
        geaendertAm: (af as { daten_geaendert_am?: string | null }).daten_geaendert_am ?? null,
      };
      setServerStand(serverStand.geaendertAm);
      let local: Awaited<ReturnType<typeof getFormDraft>> = null;
      try {
        local = await getFormDraft(af.id);
      } catch (err) {
        console.warn('[FormularPage] IDB-Lesen fehlgeschlagen', err);
      }
      if (cancelled) return;
      const entscheidung = entwurfWaehlen(serverStand, local
        ? { daten: local.data, savedAt: local.savedAt, serverStand: local.serverStand ?? null }
        : null);
      diagnose('entwurf_geladen', {
        quelle: local ? 'beide' : 'server',
        felder_server: felderAnzahl(serverData),
        felder_lokal: local ? felderAnzahl(local.data) : null,
        stand_server: serverStand.geaendertAm,
        stand_lokal: local ? new Date(local.savedAt).toISOString() : null,
        lokal_server_offen: local?.serverOffen ?? null,
        gewinner: entscheidung.quelle,
        grund: entscheidung.grund,
        app_modus: appModus(),
      }, 'entwurf', af.id);
      if (entscheidung.quelle === 'lokal' && local) {
        nextData = local.data;
        restoredFromLocal = true;
      } else if (entscheidung.quelle === 'konflikt' && local) {
        setKonflikt({ server: serverStand, lokal: { daten: local.data, savedAt: local.savedAt } });
      }
      // Legacy: alten sessionStorage-Eintrag — falls vorhanden — räumen.
      try { sessionStorage.removeItem(`formular-draft-${af.id}`); } catch { /* ignore */ }

      // Vorausgefüllte Daten der verknüpften Tour (sofern bekannt) mergen.
      // Felder, die der Fahrer schon angefasst hat (_touched), bleiben.
      //
      // WICHTIG: Seit Migration 054 pflegt der Admin die Vorgaben pro
      // Zuweisung in tour_protokoll_zuweisungen.vorgefuellte_daten (siehe
      // PrefillDialog/ProtokollSection). Der Refresh hier las aber noch
      // die Legacy-Spalte touren.vorgefuellte_daten (053) — dadurch kamen
      // nachträgliche Admin-Vorgaben (z.B. Kundendaten) NIE im Formular
      // an. Jetzt: Zuweisung zuerst, Legacy-Spalte nur als Fallback für
      // Alt-Touren aus der Zeit vor 054.
      const tourId = typeof nextData._tour_id === 'string' ? nextData._tour_id : null;
      if (tourId) {
        // Tour-Bezug für die Kopfzeile: unter dem Protokollnamen steht die
        // Route, damit der Fahrer bei mehreren gleichnamigen Protokollen
        // sieht, zu welcher Tour er gerade ausfüllt.
        try {
          const { data: bezug } = await supabase
            .from('touren')
            .select('tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt, startdatum, enddatum')
            .eq('id', tourId)
            .maybeSingle();
          if (bezug) setTourBezug(bezug);
        } catch (err) {
          console.warn('[FormularPage] Tour-Bezug laden fehlgeschlagen', err);
        }
        try {
          let prefill: Record<string, unknown> | null = null;
          let quelle = 'keine';
          const { data: zuweisung } = await supabase
            .from('tour_protokoll_zuweisungen')
            .select('vorgefuellte_daten')
            .eq('tour_id', tourId)
            .eq('template_id', af.template_id)
            .maybeSingle();
          if (zuweisung?.vorgefuellte_daten && typeof zuweisung.vorgefuellte_daten === 'object') {
            prefill = zuweisung.vorgefuellte_daten as Record<string, unknown>;
            quelle = 'tour_protokoll_zuweisungen';
          } else {
            const { data: tour } = await supabase
              .from('touren')
              .select('vorgefuellte_daten')
              .eq('id', tourId)
              .maybeSingle();
            if (tour?.vorgefuellte_daten && typeof tour.vorgefuellte_daten === 'object') {
              prefill = tour.vorgefuellte_daten as Record<string, unknown>;
              quelle = 'touren (Legacy)';
            }
          }
          if (prefill) {
            const touched = (nextData._touched && typeof nextData._touched === 'object')
              ? nextData._touched as Record<string, unknown>
              : {};
            const merged: Record<string, unknown> = { ...nextData };
            const uebernommen: string[] = [];
            for (const [k, v] of Object.entries(prefill)) {
              if (!touched[k]) { merged[k] = v; uebernommen.push(k); }
            }
            console.log('[Kundendaten-Verknüpfung]', {
              quelle, tourId, templateId: af.template_id,
              zielFelder: Object.keys(prefill), uebernommen,
            });
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
  }, [id, setServerStand]);

  // Übertragene Originale sind schreibgeschützt (der Server lehnt
  // Fahrer-Änderungen daran ohnehin ab).
  const uebertragenAuf = formular?.uebertragen_auf_id ?? null;
  const readonly = formular?.status === 'submitted' || !!uebertragenAuf;

  // Diagnose-Ereignisse (Schadensaufnahme u.a.) diesem Formular zuordnen.
  const formularIdFuerDiagnose = formular?.id ?? null;
  const fahrerIdFuerDiagnose = formular?.fahrer_id ?? null;
  useEffect(() => {
    setzeDiagnoseKontext({ formularId: formularIdFuerDiagnose, fahrerId: fahrerIdFuerDiagnose });
    return () => setzeDiagnoseKontext({ formularId: null, fahrerId: null });
  }, [formularIdFuerDiagnose, fahrerIdFuerDiagnose]);

  // `value` darf auch eine Funktion (vorheriger Wert → neuer Wert) sein.
  // Das brauchen Felder, die erst nach einem asynchronen Schritt (Upload)
  // anhängen: Mit einem fertigen Wert würden sie den Stand vom Beginn
  // des Uploads zurückschreiben und Zwischenänderungen verlieren.
  const handleChange = useCallback((fieldId: string, value: FeldWert) => {
    setData((prev) => {
      const neuerWert = typeof value === 'function' ? value(prev[fieldId]) : value;
      const next = { ...prev, [fieldId]: neuerWert };
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

  // Wenn der Sync-Drainer einen Upload abgeschlossen hat, ist der Entwurf
  // in IDB jetzt aktueller (Photo-Feld zeigt jetzt storage_path). Wir laden
  // den Stand neu und übernehmen ihn ins UI.
  //
  // WICHTIG: Nur den einen Platzhalter ersetzen, NIE den ganzen Stand.
  // Früher stand hier `setData(entwurf.data)` — der Entwurf auf dem Gerät
  // ist aber bis zu 2 s (beim Tippen länger) älter als der Bildschirm.
  // Alles aus diesem Fenster ging verloren, z.B. gerade bestätigte
  // Schadenpunkte.
  useEffect(() => {
    if (!formular) return;
    function handler(e: Event) {
      const ev = e as CustomEvent<{
        formularId: string; fieldId?: string; pendingId?: string; value?: PhotoValue;
      }>;
      const d = ev.detail;
      if (d?.formularId !== formular?.id) return;
      if (!d.fieldId || !d.pendingId || !d.value) return;
      const { fieldId, pendingId, value } = d;
      setData((prev) => {
        const ersetzt = ersetzePendingFoto(prev[fieldId], pendingId, value);
        if (ersetzt === undefined) return prev;
        diagnose('foto_nachgeladen', { feld: fieldId });
        return { ...prev, [fieldId]: ersetzt };
      });
    }
    window.addEventListener('maja:draft-updated', handler as EventListener);
    return () => window.removeEventListener('maja:draft-updated', handler as EventListener);
  }, [formular]);

  // Bild wurde in der Warteschlangen-Ansicht entfernt → auch vom Bildschirm.
  useEffect(() => {
    if (!formular) return;
    function handler(e: Event) {
      const d = (e as CustomEvent<{ formularId: string; pendingId: string }>).detail;
      if (d?.formularId !== formular?.id || !d.pendingId) return;
      setData((prev) => {
        const r = entfernePendingAusDaten(prev, [d.pendingId]);
        return r.geaendert ? r.daten : prev;
      });
    }
    window.addEventListener('maja:foto-entfernt', handler as EventListener);
    return () => window.removeEventListener('maja:foto-entfernt', handler as EventListener);
  }, [formular]);

  // Beim Öffnen: Warteschlange dieses Formulars abgleichen. Löst hängende
  // Einträge auf (z.B. Bilder vom alten, ungültigen Kennzeichen-Pfad, die
  // längst neu hochgeladen sind) — ohne Formulardaten anzufassen.
  const abgleichFuerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!formular || loading || readonly) return;
    if (abgleichFuerRef.current === formular.id) return;
    abgleichFuerRef.current = formular.id;
    void pruefen({ formularId: formular.id, aktuelleDaten: data, anlass: 'formular_offen' })
      .catch((err) => console.warn('[FormularPage] Abgleich fehlgeschlagen', err));
  }, [formular, loading, readonly, data, pruefen]);

  async function clearLocalDraft() {
    if (!id) return;
    try { await deleteFormDraft(id); } catch { /* ignore */ }
  }

  async function saveDraft(): Promise<void> {
    if (!formular) return;
    if (guard()) return;
    setSaving('draft');
    setStatusMsg(null);
    const ok = await entwurfSync.serverSichern('entwurf');
    setSaving('idle');
    if (!ok) {
      const msg = 'Entwurf konnte nicht auf dem Server gespeichert werden — er ist auf diesem Gerät gesichert und wird übertragen, sobald es geht.';
      setError(msg);
      throw new Error(msg);
    }
    setStatusMsg('Entwurf gespeichert.');
  }

  /**
   * Zwischenprotokoll abschließen (Übernahme-Teil): sichert den aktuellen
   * Stand + Bilder als PDF, ohne das Formular endgültig einzureichen —
   * der Übergabe-Teil bleibt weiter bearbeitbar. Zusätzlich werden die
   * konfigurierten E-Mails ausgelöst (E-Mail-Konfiguration wie gehabt).
   */
  async function handleZwischenprotokoll() {
    if (!formular || !template) return;
    if (guard()) return;

    // (1) Uploads prüfen — läuft die Generierung los, während Fotos noch
    // in der Offline-Queue liegen, fehlen sie in der PDF und der Lauf
    // dauert unnötig lange. Klare Meldung statt Fehler.
    // Nur wartende Bilder sperren — fehlgeschlagene würden sonst das
    // Zwischenprotokoll für immer blockieren (sie stehen in der Leiste oben).
    const pending = (await getUploadsForFormular(formular.id).catch(() => []))
      .filter((i) => !istFehlgeschlagen(i));
    if (pending.length > 0) {
      setError(
        `${pending.length} ${pending.length === 1 ? 'Bild wird' : 'Bilder werden'} noch hochgeladen. `
        + 'Bitte kurz warten und es dann erneut versuchen — die Bilder fehlen sonst im Zwischenprotokoll.',
      );
      triggerSync();
      return;
    }
    if (!navigator.onLine) {
      setError('Offline — das Zwischenprotokoll kann erst mit Verbindung erzeugt werden.');
      return;
    }

    setZwischenBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      // (2) Aktuellen Stand persistieren — die Generierung setzt darauf auf.
      const { error: saveErr } = await supabase
        .from('ausgefuellte_formulare')
        .update({ daten: data as Json })
        .eq('id', formular.id);
      if (saveErr) throw new Error(saveErr.message);
      // Eigener Schreibvorgang ohne neuen Stand → beim nächsten Autosave
      // nicht als „anderer Stand auf dem Server" missverstehen.
      entwurfSync.merkeGesendet(data);
      setSavedDataJson(JSON.stringify(data));
      // Übernahme-Teil ist abgeschlossen → Werte in den Vorschlags-Pool.
      void merkeAusFormular(template.schema, data, isTestUser);
    } catch (err) {
      setZwischenBusy(false);
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
      return;
    }
    setZwischenBusy(false);

    // (3) Sofortige Bestätigung — PDF-Erzeugung und Versand laufen im
    // HINTERGRUND. Der Fahrer wird nie blockiert und der Übergabe-Teil
    // bleibt sofort weiter bearbeitbar. Fehler landen im
    // email_send_log bzw. pdf_fehler und sind in Eingänge sichtbar +
    // dort wiederholbar.
    setStatusMsg(
      'Zwischenprotokoll wird im Hintergrund erstellt und versendet — '
      + 'du kannst direkt mit dem Übergabe-Teil weitermachen.',
    );
    const snapshot = { ...formular, daten: data } as unknown as AusgefuelltesFormular;
    const tpl = template;
    void (async () => {
      console.log('[ZP] gestartet', {
        formularId: snapshot.id,
        templateId: tpl.id,
        konfig: tpl.email_config?.zwischenprotokoll ?? null,
      });

      // ---- Schritt 1: Dokument erzeugen -------------------------------
      // WICHTIG: Ein Fehlschlag hier darf den Versand NICHT verhindern.
      // Genau daran ist die Kette vorher gescheitert (früher `return`).
      let anhang: { path: string; filename: string } | null = null;
      let erzeugungsFehler: string | null = null;
      try {
        const { path, erstellt_am, filename } = await generateAndUploadZwischenprotokoll(
          tpl, snapshot, zwischenprotokollPdfIds(tpl),
        );
        anhang = { path, filename };
        await supabase
          .from('ausgefuellte_formulare')
          .update({
            zwischenprotokoll_url: path,
            zwischenprotokoll_erstellt_am: erstellt_am,
            zwischenprotokoll_status: 'ok',
            zwischenprotokoll_fehler: null,
          })
          .eq('id', snapshot.id);
        setFormular((cur) => (cur && cur.id === snapshot.id
          ? ({ ...cur, ...({ zwischenprotokoll_url: path, zwischenprotokoll_erstellt_am: erstellt_am } as object) } as AusgefuelltesFormular)
          : cur));
        setStatusMsg('Zwischenprotokoll erstellt — E-Mail wird versendet …');
      } catch (err) {
        erzeugungsFehler = err instanceof Error ? err.message : String(err);
        console.error('[ZP] Erzeugung fehlgeschlagen', err);
        // Fehler festhalten, damit er in Eingänge sichtbar ist und der
        // Vorgang dort wiederholt werden kann.
        await supabase
          .from('ausgefuellte_formulare')
          .update({
            zwischenprotokoll_status: 'fehler',
            zwischenprotokoll_fehler: erzeugungsFehler,
          })
          .eq('id', snapshot.id)
          .then(undefined, (e) => console.warn('[ZP] Status-Update fehlgeschlagen', e));
        // KEIN return — die E-Mail geht trotzdem raus.
      }

      // ---- Schritt 2: E-Mail — läuft IMMER ---------------------------
      try {
        const entry = await runZwischenprotokollEmail(tpl, snapshot, {
          submitterEmail,
          fahrerEmail: submitterEmail,
          fahrerName: profile ? displayName(profile) : null,
          // Genau das eben erzeugte Dokument anhängen. Ist die Erzeugung
          // gescheitert, sagen wir das explizit — dann versucht der
          // Versand es nicht noch einmal und sendet ohne Anhang.
          zwischenprotokoll: anhang,
          anhangBereitsVersucht: true,
        });
        if (entry) {
          await appendEmailLog(snapshot.id, [entry]);
          if (entry.success) {
            await supabase
              .from('ausgefuellte_formulare')
              .update({ zwischenprotokoll_versendet_am: new Date().toISOString() })
              .eq('id', snapshot.id)
              .then(undefined, () => { /* nicht kritisch */ });
          }
          if (!entry.success) {
            setError(
              `Die Zwischenprotokoll-E-Mail ging nicht raus: ${entry.error ?? 'unbekannter Fehler'} — `
              + 'in Eingänge erneut versendbar.',
            );
          } else if (erzeugungsFehler) {
            setError(
              `E-Mail versendet, aber OHNE Anhang: ${erzeugungsFehler} — `
              + 'das Protokoll kann in Eingänge erneut erzeugt und versendet werden.',
            );
          } else {
            setStatusMsg('Zwischenprotokoll erstellt und versendet.');
          }
        } else if (erzeugungsFehler) {
          // Keine Vorlage aktiv → kein Versand vorgesehen; den
          // Erzeugungsfehler trotzdem zeigen.
          setError(
            `Zwischenprotokoll konnte nicht erstellt werden: ${erzeugungsFehler} — `
            + 'dein Formularstand ist gespeichert; in Eingänge erneut erzeugbar.',
          );
        }
      } catch (mailErr) {
        console.warn('[Zwischenprotokoll] E-Mail-Versand fehlgeschlagen', mailErr);
      }
    })();
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
    // Erst abgleichen: veraltete Einträge (z.B. ersetzte Fotos, alter
    // Kennzeichen-Pfad) dürfen das Abschließen nicht mehr sperren.
    // Fehlgeschlagene bleiben fehlgeschlagen — darüber entscheidet gleich
    // der Fahrer.
    await pruefen({
      formularId: formular.id, aktuelleDaten: data, anlass: 'abschliessen', fehlgeschlageneNeuStarten: false,
    }).catch(() => null);
    const eigene = await getUploadsForFormular(formular.id).catch(() => []);
    const fehlgeschlagen = eigene.filter(istFehlgeschlagen).map((i) => i.id);
    if (fehlgeschlagen.length > 0) {
      setSaving('idle');
      setFehlendeBilderFrage(fehlgeschlagen);
      return;
    }
    await abschliessen(data, false, eigene.length);
  }

  /** Fahrer hat bestätigt: ohne die fehlgeschlagenen Bilder abschließen. */
  async function trotzdemAbschliessen() {
    if (!formular || !template || !fehlendeBilderFrage) return;
    const ids = fehlendeBilderFrage;
    setFehlendeBilderFrage(null);
    const bereinigt = entfernePendingAusDaten(data, ids).daten;
    // Pflichtbilder werden wie bisher angemahnt.
    const { valid, missing } = validateForm(template.schema, bereinigt);
    if (!valid) {
      setError(
        `Diese Pflichtfelder fehlen, weil Bilder nicht hochgeladen werden konnten: ${missing.join(', ')}. `
        + 'Bitte die Bilder neu aufnehmen.',
      );
      return;
    }
    diagnose('abschliessen_ohne_bilder', { anzahl: ids.length }, 'upload', formular.id);
    setData(bereinigt);
    setSaving('submit');
    setError(null);
    const wartend = (await getUploadsForFormular(formular.id).catch(() => []))
      .filter((i) => !istFehlgeschlagen(i)).length;
    await abschliessen(bereinigt, true, wartend);
  }

  async function abschliessen(data: Record<string, unknown>, fehlendeBilderAkzeptiert: boolean, wartendeUploads: number) {
    if (!formular || !template) return;
    // Wenn offline ODER noch Photo-Uploads anhängig sind: in IDB als
    // pending-submission ablegen und User informieren. Der Sync-Drainer
    // reicht das Formular nach, sobald wieder Empfang da ist und die
    // Upload-Queue für dieses Formular leer ist.
    if (!navigator.onLine || wartendeUploads > 0) {
      await enqueueSubmission({
        formularId: formular.id,
        data,
        queuedAt: Date.now(),
        attempts: 0,
        lastError: null,
        submitterEmail,
        fehlendeBilderAkzeptiert,
      });
      // Den Entwurf NICHT löschen — falls noch Edits nötig werden.
      await saveFormDraft({
        id: formular.id, data,
        serverUpdatedAt: formular.created_at ?? null,
        savedAt: Date.now(),
      });
      setSaving('idle');
      triggerSync();
      const n = wartendeUploads;
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
        lastError: err.message, submitterEmail, fehlendeBilderAkzeptiert,
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

    // Eingetragene Werte in den Vorschlags-Pool übernehmen (nur Felder
    // mit aktivierter Option). Läuft nebenher — der Pool ist Komfort,
    // kein Teil der Einreichung.
    void merkeAusFormular(template.schema, data, isTestUser);

    // Das Zwischenprotokoll bleibt bewusst ERHALTEN. Früher wurde es
    // beim Einreichen gelöscht; dann lässt sich aber ein fehlgeschlagener
    // Zwischenprotokoll-Versand später nicht mehr aus Eingänge nachholen.
    // Es ist ein eigenes Dokument mit eigenem Zeitstempel und stört die
    // finalen PDFs nicht.

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

  // Seitenwechsel im Formular → sofort zum Server speichern.
  const vorherigeSeiteRef = useRef<string | null>(null);
  useEffect(() => {
    if (vorherigeSeiteRef.current && vorherigeSeiteRef.current !== currentPageId) beiSeitenwechsel();
    vorherigeSeiteRef.current = currentPageId;
  }, [currentPageId, beiSeitenwechsel]);

  // Beim ersten Öffnen eines Formulars: dauerhaften Speicher anfordern
  // (Safari/iOS löscht ihn dann seltener) und den Modus protokollieren.
  const speicherAngefragtRef = useRef(false);
  useEffect(() => {
    if (!formular || readonly || speicherAngefragtRef.current) return;
    speicherAngefragtRef.current = true;
    const fid = formular.id;
    diagnose('app_modus', { modus: appModus(), ios: istIos() }, 'entwurf', fid);
    void (async () => {
      try {
        const sm = navigator.storage;
        if (!sm?.persist) { diagnose('speicher_persist', { ergebnis: 'nicht_unterstuetzt' }, 'entwurf', fid); return; }
        const bereits = sm.persisted ? await sm.persisted() : false;
        const ergebnis = bereits ? true : await sm.persist();
        diagnose('speicher_persist', { ergebnis, bereits }, 'entwurf', fid);
      } catch (err) {
        diagnose('speicher_persist', { ergebnis: 'fehler', fehler: err instanceof Error ? err.message : String(err) }, 'entwurf', fid);
      }
    })();
  }, [formular, readonly]);

  /** Konflikt beim Öffnen: Fahrer wählt Server- oder Gerätestand. */
  async function konfliktBeimLadenLoesen(wahl: 'server' | 'geraet') {
    if (!formular || !konflikt) return;
    const { server, lokal } = konflikt;
    // Der verworfene Stand wird als Version auf dem Server gesichert.
    const verworfen = wahl === 'server' ? lokal.daten : server.daten;
    void supabase.rpc('formular_version_sichern', {
      p_formular_id: formular.id, p_daten: verworfen as Json,
      p_vorgang: wahl === 'server' ? 'verworfen_geraet' : 'verworfen_server', p_app_modus: appModus(),
    }).then(({ error: e }) => { if (e) console.warn('[FormularPage] Version sichern fehlgeschlagen', e.message); });
    diagnose('entwurf_konflikt', {
      wahl, felder_server: felderAnzahl(server.daten), felder_lokal: felderAnzahl(lokal.daten),
    }, 'entwurf', formular.id);
    setKonflikt(null);
    if (wahl === 'geraet') {
      setData(lokal.daten);   // → dirty → wird zum Server gespeichert
    } else {
      setData(server.daten);
      await lokalenEntwurfSetzen({
        id: formular.id, data: server.daten, serverUpdatedAt: null, savedAt: Date.now(),
        serverStand: server.geaendertAm, serverOffen: false,
      }).catch(() => {});
    }
  }

  /** Konflikt beim Speichern (anderer Stand kam inzwischen auf den Server). */
  async function konfliktBeimSpeichernLoesen(wahl: 'meiner' | 'server') {
    if (!formular) return;
    diagnose('entwurf_konflikt', { wahl, zeitpunkt: 'speichern' }, 'entwurf', formular.id);
    if (wahl === 'meiner') {
      await entwurfSync.serverSichern('konflikt_aufgeloest', true);
      return;
    }
    const { data: akt } = await supabase.from('ausgefuellte_formulare')
      .select('daten, daten_geaendert_am').eq('id', formular.id).maybeSingle();
    const a = akt as { daten: Record<string, unknown>; daten_geaendert_am: string | null } | null;
    if (!a) return;
    await supabase.rpc('formular_version_sichern', {
      p_formular_id: formular.id, p_daten: data as Json, p_vorgang: 'verworfen_geraet', p_app_modus: appModus(),
    });
    await lokalenEntwurfSetzen({
      id: formular.id, data: a.daten ?? {}, serverUpdatedAt: null, savedAt: Date.now(),
      serverStand: a.daten_geaendert_am, serverOffen: false,
    }).catch(() => {});
    window.location.reload();
  }
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
  // ------------------------------------------------------------------
  // Sichtbarkeitsregeln der Aktionsleiste — bewusst hier zentral, damit
  // sie an genau EINER Stelle stehen:
  //
  //   "Speichern und später fortfahren"  auf JEDER Seite, immer genau
  //                                      einmal, immer sekundär.
  //   "Endgültig abschließen"            NUR auf der letzten Seite.
  //   Zwischenprotokoll-Button           NUR am Ende des Übernahme-Teils
  //                                      und nur wenn im Template
  //                                      aktiviert — nicht auf den
  //                                      Übergabe-Seiten.
  // ------------------------------------------------------------------

  /** Letzter (Abschluss-)Tab; einseitige Formulare sind immer "letzte Seite". */
  const isLastPage = pages.length === 0 || currentPageIdx >= pages.length - 1;

  // Die Seite, die die im Template konfigurierte Sektion enthält
  // (schema.zwischenprotokoll_nach_section). Ohne Konfiguration im
  // Template erscheint der Button nirgends. Bei einseitigen Formularen
  // reicht das Vorhandensein der konfigurierten Sektion.
  const zwischenSectionId = template?.schema?.zwischenprotokoll_nach_section ?? null;
  const showZwischenButton = !readonly && !!zwischenSectionId && (
    currentPage
      ? currentPage.sectionIds.includes(zwischenSectionId)
      : (template?.schema?.sections ?? []).some((s) => s.id === zwischenSectionId)
  );

  // Unterzeile unter dem Protokollnamen: Route, dahinter Datum · Tour-ID.
  // Fehlt die Route (Start und Ziel leer), bleibt nur der Zusatz stehen.
  const bezugRoute = tourRoute(tourBezug);
  const bezugZusatz = tourBezug
    ? tourZusatz(tourBezug.startdatum ?? tourBezug.enddatum, tourBezug.tour_id)
    : '';

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">{title}</h1>
        {(bezugRoute || bezugZusatz) && (
          <p className="text-sm text-maja-ink">
            {bezugRoute && <span className="font-medium">{bezugRoute}</span>}
            {bezugRoute && bezugZusatz && <span className="text-maja-muted"> · </span>}
            {bezugZusatz && <span className="text-maja-muted">{bezugZusatz}</span>}
          </p>
        )}
        {formular && (
          <p className="text-sm text-maja-muted">
            Status: {uebertragenAuf ? 'übertragen' : formular.status === 'submitted' ? 'eingereicht' : 'Entwurf'} · Erstellt am{' '}
            {new Date(formular.created_at).toLocaleString('de-DE')}
          </p>
        )}
        {!readonly && (
          <SpeicherStatusZeile status={entwurfSync.status} onKonfliktLoesen={(w) => void konfliktBeimSpeichernLoesen(w)} />
        )}
      </div>
      <button onClick={() => safeNavigate('/')} className="btn-secondary">← Zurück</button>
      {uebertragenAuf && (
        <div role="status" className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Dieses Formular wurde auf ein anderes Template übertragen.</p>
          <p className="mt-0.5 text-xs">
            Hier steht nur noch das unveränderte Original. Weiter geht es im neuen Formular.
          </p>
          {lokalNichtUebernommen && (
            <p className="mt-1 text-xs font-medium text-red-700">
              Auf diesem Gerät lagen noch nicht gespeicherte Änderungen. Sie wurden nicht
              übernommen — bitte die Verwaltung informieren.
            </p>
          )}
          <button type="button" className="btn-primary mt-2 text-sm"
                  onClick={() => navigate(`/formular/${uebertragenAuf}`)}>
            Zum neuen Formular
          </button>
        </div>
      )}
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

      {!readonly && formular && appModus() === 'browser' && <InstallHinweis />}
      {konflikt && (
        <EntwurfKonfliktDialog
          server={{
            felder: felderAnzahl(konflikt.server.daten),
            zeit: konflikt.server.geaendertAm ? new Date(konflikt.server.geaendertAm).toLocaleString('de-DE') : null,
          }}
          geraet={{ felder: felderAnzahl(konflikt.lokal.daten), zeit: new Date(konflikt.lokal.savedAt).toLocaleString('de-DE') }}
          onWahl={(w) => void konfliktBeimLadenLoesen(w)}
        />
      )}

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
                  onClick={() => {
                    setCurrentPageId(p.id);
                    // Wie beim Vor/Zurück-Pager: nach oben scrollen,
                    // sonst wirken Inhalt und Aktionsleiste verschoben.
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
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
      {fehlendeBilderFrage && (
        <div role="alertdialog" aria-labelledby="fehlende-bilder-titel" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p id="fehlende-bilder-titel" className="font-semibold">
            {fehlendeBilderFrage.length === 1
              ? '1 Bild konnte nicht hochgeladen werden.'
              : `${fehlendeBilderFrage.length} Bilder konnten nicht hochgeladen werden.`}
            {' '}Trotzdem abschließen?
          </p>
          <p className="mt-1 text-xs">
            Diese Bilder fehlen dann im Protokoll. Alternativ oben in der Leiste „Details" öffnen und erneut versuchen.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void trotzdemAbschliessen()}>
              Trotzdem abschließen
            </button>
            <button type="button" className="btn-secondary" onClick={() => setFehlendeBilderFrage(null)}>
              Zurück
            </button>
          </div>
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

      {/* Aktionsleiste — GENAU EINMAL, hier auf Seitenebene. Bewusst
          NICHT innerhalb der Seiten-/Abschnitts-Darstellung, sonst
          entstünde sie pro Seite neu. Beim Seitenwechsel bleibt die
          Komponente montiert, nur ihre Props ändern sich; es kann also
          keine alte Instanz stehen bleiben. */}
      {!readonly && !submittedSummary && (
        <FormularAktionsleiste
          saving={saving}
          zwischenBusy={zwischenBusy}
          zeigeZwischenprotokoll={showZwischenButton}
          istLetzteSeite={isLastPage}
          onVorschau={() => setPreviewOpen(true)}
          onEntwurfSpeichern={() => void saveDraft().catch(() => {})}
          onZwischenprotokoll={() => void handleZwischenprotokoll()}
          onAbschliessen={submit}
        />
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
