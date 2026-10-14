import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import {
  aktualisiereUploadWennVorhanden,
  cleanupOldDrafts,
  enqueueSubmission,
  getAllPendingSubmissions,
  getFormDraft,
  getPendingSubmission,
  getUploadQueue,
  removeFromUploadQueue,
  removePendingSubmission,
  saveFormDraft,
  type UploadQueueItem,
  type PendingSubmissionRecord,
} from '../lib/offlineDb';
import { uploadToOneDrive } from '../lib/onedrive';
import { kennzeichenAusDaten } from '../lib/onedrivePaths';
import {
  entfernePendingAusDaten, fehlerArt, istFehlgeschlagen, uploadPfad, wartezeitMs,
} from '../lib/uploadQueue';
import { uploadAbgleich, type AbgleichErgebnis } from '../lib/uploadAbgleich';
import { diagnose } from '../lib/diagnose';
import { supabase } from '../lib/supabase';
import { runSubmissionEmails } from '../lib/submissionEmails';
import { merkeAusFormular } from '../lib/feldVorschlaege';
import { ersetzePendingFoto } from '../lib/pendingFoto';
import type {
  AusgefuelltesFormular, FormularTemplate, PhotoValue,
} from '../types/db';

/**
 * Pendings + Drainer für Foto-Uploads und Formular-Einreichungen.
 *
 *  - Foto-Queue: Beim Aufnehmen eines Fotos wird das Bild sofort in IDB
 *    abgelegt. Hier wird die Queue periodisch (30 s) und bei online/online-
 *    Ereignis abgearbeitet — pro Eintrag mit Exponential-Backoff.
 *
 *  - Submission-Queue: Wenn das Einreichen scheitert (offline / Server-
 *    fehler), legt FormularPage eine Pending-Submission ab. Hier wird sie
 *    automatisch nachgereicht, sobald wieder Empfang da ist.
 */

/** Ein Eintrag der sichtbaren Warteschlange. */
export interface WarteschlangenEintrag {
  art: 'bild' | 'formular';
  id: string;
  formularId: string;
  fieldId?: string;
  status: 'wartet' | 'fehlgeschlagen' | 'blockiert';
  fehler: string | null;
  versuche: number;
  blob?: Blob;
  /** Nur Formulare: so viele Bilder laufen noch. */
  wartetAufBilder?: number;
  /** Kennzeichen aus dem Stand auf dem Gerät — zur Orientierung in der Liste. */
  kennzeichen?: string | null;
}

interface SyncContextValue {
  online: boolean;
  /** Bilder, die noch hochgeladen werden (ohne fehlgeschlagene). */
  pendingUploads: number;
  /** Bilder mit dauerhaftem Fehler — blockieren nichts, brauchen eine Entscheidung. */
  failedUploads: number;
  pendingSubmissions: number;
  syncing: boolean;
  triggerSync: () => void;
  /** Liste für die Warteschlangen-Ansicht. */
  eintraege: () => Promise<WarteschlangenEintrag[]>;
  erneutVersuchen: (e: Pick<WarteschlangenEintrag, 'art' | 'id' | 'formularId'>) => Promise<void>;
  /** Bild aus Warteschlange UND Formular nehmen. Formulare lassen sich nicht entfernen. */
  bildEntfernen: (id: string) => Promise<void>;
  /** Abgleich + Sync („Synchronisierung prüfen"). */
  pruefen: (opts?: PruefOptionen) => Promise<AbgleichErgebnis>;
}

type PruefOptionen = {
  formularId?: string;
  aktuelleDaten?: Record<string, unknown>;
  anlass?: string;
  fehlgeschlageneNeuStarten?: boolean;
};

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const TICK_INTERVAL_MS = 30_000;
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const [pendingUploads, setPendingUploads] = useState(0);
  const [failedUploads, setFailedUploads] = useState(0);
  const [pendingSubmissions, setPendingSubmissions] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const runningRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([getUploadQueue(), getAllPendingSubmissions()]);
      const fehl = u.filter(istFehlgeschlagen).length;
      setPendingUploads(u.length - fehl);
      setFailedUploads(fehl);
      setPendingSubmissions(s.length);
    } catch { /* IDB nicht verfügbar — ignorieren. */ }
  }, []);

  const tick = useCallback(async () => {
    if (runningRef.current) return;
    if (!navigator.onLine) {
      await refreshCounts();
      return;
    }
    runningRef.current = true;
    setSyncing(true);
    try {
      await processUploadQueue();
      await processPendingSubmissions();
    } finally {
      runningRef.current = false;
      setSyncing(false);
      await refreshCounts();
    }
  }, [refreshCounts]);

  // Initial: alte Drafts aufräumen, Warteschlange abgleichen, Zähler laden.
  // Der Abgleich löst hängende Einträge auf dem Gerät auf (verwaiste
  // Einträge raus, fehlgeschlagene mit neu berechnetem Pfad erneut) —
  // ohne dass Browserdaten gelöscht werden müssen.
  useEffect(() => {
    void cleanupOldDrafts(DRAFT_TTL_MS).catch(() => { /* noop */ });
    void uploadAbgleich({ anlass: 'app_start' })
      .catch((err) => console.warn('[Sync] Abgleich beim Start fehlgeschlagen', err))
      // Direkt danach synchronisieren — nicht erst beim nächsten 30-s-Takt.
      .finally(() => { void refreshCounts(); void tick(); });
  }, [refreshCounts, tick]);

  // Periodischer Tick + on-online + manueller Trigger.
  useEffect(() => {
    void tick();
    const handle = window.setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
    const onlineHandler = () => { void tick(); };
    window.addEventListener('online', onlineHandler);
    return () => {
      window.clearInterval(handle);
      window.removeEventListener('online', onlineHandler);
    };
  }, [tick]);

  // Externer Trigger (z.B. nach manueller Aktion).
  const triggerSync = useCallback(() => { void tick(); }, [tick]);

  const eintraege = useCallback(async (): Promise<WarteschlangenEintrag[]> => {
    const [u, subs] = await Promise.all([getUploadQueue(), getAllPendingSubmissions()]);
    const liste: WarteschlangenEintrag[] = u.map((i) => ({
      art: 'bild', id: i.id, formularId: i.formularId, fieldId: i.fieldId,
      status: istFehlgeschlagen(i) ? 'fehlgeschlagen' : 'wartet',
      fehler: i.lastError, versuche: i.attempts, blob: i.blob,
    }));
    const kz = new Map<string, string | null>();
    for (const fid of new Set([...u.map((i) => i.formularId), ...subs.map((x) => x.formularId)])) {
      const d = await getFormDraft(fid).catch(() => null);
      kz.set(fid, kennzeichenAusDaten(d?.data) ?? kennzeichenAusDaten(subs.find((x) => x.formularId === fid)?.data));
    }
    for (const e of liste) e.kennzeichen = kz.get(e.formularId) ?? null;
    for (const sub of subs) {
      const eigene = u.filter((i) => i.formularId === sub.formularId);
      const fehl = eigene.filter(istFehlgeschlagen).length;
      const blockiert = fehl > 0 && fehl === eigene.length && !sub.fehlendeBilderAkzeptiert;
      liste.push({
        art: 'formular', id: sub.formularId, formularId: sub.formularId,
        status: blockiert ? 'blockiert' : 'wartet',
        fehler: sub.lastError, versuche: sub.attempts,
        wartetAufBilder: eigene.length - fehl,
        kennzeichen: kz.get(sub.formularId) ?? null,
      });
    }
    return liste;
  }, []);

  const erneutVersuchen = useCallback(async (e: Pick<WarteschlangenEintrag, 'art' | 'id' | 'formularId'>) => {
    if (e.art === 'bild') {
      await aktualisiereUploadWennVorhanden(e.id, { status: 'wartet', attempts: 0, nextRetryAt: 0 });
    } else {
      const sub = await getPendingSubmission(e.formularId);
      if (sub) await enqueueSubmission({ ...sub, attempts: 0, lastError: null });
    }
    await refreshCounts();
    void tick();
  }, [refreshCounts, tick]);

  const bildEntfernen = useCallback(async (id: string) => {
    const item = (await getUploadQueue()).find((i) => i.id === id);
    await removeFromUploadQueue(id);
    if (item) {
      await platzhalterEntfernen(item.formularId, [id]);
      window.dispatchEvent(new CustomEvent('maja:foto-entfernt', {
        detail: { formularId: item.formularId, pendingId: id },
      }));
      diagnose('upload_entfernt', { feld: item.fieldId, versuche: item.attempts, fehlgeschlagen: istFehlgeschlagen(item) }, 'upload', item.formularId);
    }
    await refreshCounts();
  }, [refreshCounts]);

  const pruefen = useCallback(async (opts?: PruefOptionen) => {
    const r = await uploadAbgleich({ anlass: 'manuell', ...opts });
    await refreshCounts();
    void tick();
    return r;
  }, [refreshCounts, tick]);

  const value = useMemo<SyncContextValue>(() => ({
    online, pendingUploads, failedUploads, pendingSubmissions, syncing, triggerSync,
    eintraege, erneutVersuchen, bildEntfernen, pruefen,
  }), [online, pendingUploads, failedUploads, pendingSubmissions, syncing, triggerSync,
    eintraege, erneutVersuchen, bildEntfernen, pruefen]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync muss innerhalb von <SyncProvider> verwendet werden');
  return ctx;
}

// ---------------------------------------------------------------
// Drainer-Implementierungen
// ---------------------------------------------------------------

/**
 * Verarbeitet die Foto-Upload-Queue: sequenziell, mit Backoff. Bei Erfolg
 * wird der Eintrag entfernt und — falls vorhanden — der Formular-Entwurf
 * in IDB so aktualisiert, dass das Photo-Feld jetzt einen storage_path
 * trägt statt einer pending-Referenz.
 *
 * UI-Update für aktuell mounted FormularPage: wir senden ein CustomEvent,
 * die Page reagiert und lädt den Draft neu.
 */
async function processUploadQueue(): Promise<void> {
  const now = Date.now();
  let items: UploadQueueItem[];
  try {
    items = await getUploadQueue();
  } catch { return; }
  const formularInfo = new Map<string, Promise<FormularPfadInfo | null>>();
  for (const item of items) {
    // Dauerhaft fehlgeschlagen → nur noch auf Knopfdruck („Erneut versuchen")
    // bzw. nach einem Abgleich. Kein endloses „Synchronisiere …".
    if (istFehlgeschlagen(item)) continue;
    if (item.nextRetryAt > now) continue;
    let fullPath = '';
    try {
      // Pfad JETZT aus dem aktuellen Formularstand bilden — nicht der beim
      // Einreihen gespeicherte Ordner. Eine Kennzeichen-Korrektur greift so
      // auch für schon wartende Bilder.
      if (!formularInfo.has(item.formularId)) formularInfo.set(item.formularId, ladePfadInfo(item.formularId));
      const info = await formularInfo.get(item.formularId)!;
      fullPath = uploadPfad({
        item,
        kennzeichen: info?.kennzeichen ?? null,
        datum: info?.datum ?? null,
        templateName: info?.templateName ?? null,
      });
      await uploadToOneDrive(fullPath, item.blob);
      const newValue: PhotoValue = {
        storage_path: fullPath,
        mime_type: item.blob.type || 'image/jpeg',
        size_bytes: item.blob.size,
      };
      await applyUploadSuccessToDraft(item.formularId, item.fieldId, item.id, newValue);
      await removeFromUploadQueue(item.id);
      if (item.attempts > 0) diagnose('upload_nachgeholt', { feld: item.fieldId, versuche: item.attempts }, 'upload', item.formularId);
      // Page-Komponente (falls mounted) auf GENAU dieses Foto hinweisen —
      // sie ersetzt nur den Platzhalter, nicht ihren ganzen Stand.
      window.dispatchEvent(new CustomEvent('maja:draft-updated', {
        detail: {
          formularId: item.formularId,
          fieldId: item.fieldId,
          pendingId: item.id,
          value: newValue,
        },
      }));
    } catch (err) {
      const attempts = item.attempts + 1;
      const lastError = err instanceof Error ? err.message : String(err);
      const art = fehlerArt(err, item.attempts);
      diagnose('upload_fehler', {
        feld: item.fieldId, versuch: attempts, art, fehler: lastError.slice(0, 300),
        pfad_laenge: fullPath.length,
      }, 'upload', item.formularId);
      // Nur ändern, wenn der Eintrag noch existiert — sonst holte ein
      // Fehlversuch ein inzwischen entferntes Bild zurück.
      await aktualisiereUploadWennVorhanden(item.id, art === 'dauerhaft'
        ? { attempts, lastError, status: 'fehlgeschlagen', nextRetryAt: Number.MAX_SAFE_INTEGER, letzterPfad: fullPath }
        : { attempts, lastError, status: 'wartet', nextRetryAt: now + wartezeitMs(attempts), letzterPfad: fullPath },
      ).catch(() => false);
    }
  }
}

interface FormularPfadInfo {
  kennzeichen: string | null;
  datum: string | null;
  templateName: string | null;
}

/**
 * Bestandteile des Upload-Ordners: Kennzeichen aus dem neuesten Stand auf
 * dem Gerät (Entwurf, sonst wartende Einreichung, sonst Server), Datum und
 * Templatename vom Server. Offline/Fehler → null-Felder; dann wird der
 * gespeicherte Ordner bereinigt verwendet (siehe uploadPfad).
 */
async function ladePfadInfo(formularId: string): Promise<FormularPfadInfo | null> {
  const entwurf = await getFormDraft(formularId).catch(() => null);
  const einreichung = await getPendingSubmission(formularId).catch(() => null);
  let kennzeichen = kennzeichenAusDaten(entwurf?.data) ?? kennzeichenAusDaten(einreichung?.data);
  try {
    const { data, error } = await supabase
      .from('ausgefuellte_formulare')
      .select('created_at, kz:daten->>kennzeichen, kz2:daten->>Kennzeichen, template:template_id (name)')
      .eq('id', formularId)
      .maybeSingle();
    if (error || !data) return { kennzeichen, datum: null, templateName: null };
    const row = data as unknown as { created_at: string | null; kz: string | null; kz2: string | null; template: { name: string } | null };
    if (kennzeichen == null) kennzeichen = row.kz ?? row.kz2 ?? null;
    return {
      kennzeichen,
      datum: row.created_at?.slice(0, 10) ?? null,
      templateName: row.template?.name ?? null,
    };
  } catch {
    return { kennzeichen, datum: null, templateName: null };
  }
}

/** Platzhalter aus Entwurf und wartender Einreichung entfernen. */
async function platzhalterEntfernen(formularId: string, pendingIds: string[]): Promise<void> {
  const entwurf = await getFormDraft(formularId).catch(() => null);
  if (entwurf) {
    const r = entfernePendingAusDaten(entwurf.data, pendingIds);
    if (r.geaendert) await saveFormDraft({ ...entwurf, data: r.daten, savedAt: Date.now() });
  }
  const sub = await getPendingSubmission(formularId).catch(() => null);
  if (sub) {
    const r = entfernePendingAusDaten(sub.data, pendingIds);
    if (r.geaendert) await enqueueSubmission({ ...sub, data: r.daten });
  }
}

/**
 * Trägt ein fertig hochgeladenes Foto ein — im Entwurf UND in einer
 * eventuell wartenden Einreichung. Ersetzt wird nur der Platzhalter mit
 * genau dieser pending_id (siehe lib/pendingFoto).
 *
 * Vorher: Die wartende Einreichung blieb unberührt. Wurde offline oder
 * mit offenen Uploads eingereicht, ging das Formular später mit den
 * Platzhaltern statt der Fotos raus — im PDF fehlten sie. Außerdem
 * überschrieb ein Einzelfoto-Upload das Feld auch dann, wenn der Fahrer
 * inzwischen neu fotografiert hatte, und in Zusatzbilder-Listen wurde
 * nie etwas ersetzt (die Kennung passte nicht).
 */
async function applyUploadSuccessToDraft(
  formularId: string,
  fieldId: string,
  pendingId: string,
  newValue: PhotoValue,
): Promise<void> {
  const draft = await getFormDraft(formularId);
  if (draft) {
    const ersetzt = ersetzePendingFoto((draft.data as Record<string, unknown>)[fieldId], pendingId, newValue);
    if (ersetzt !== undefined) {
      draft.data[fieldId] = ersetzt;
      draft.savedAt = Date.now();
      await saveFormDraft(draft);
    }
  }
  try {
    const wartend = (await getAllPendingSubmissions()).find((s) => s.formularId === formularId);
    if (wartend) {
      const ersetzt = ersetzePendingFoto(wartend.data[fieldId], pendingId, newValue);
      if (ersetzt !== undefined) {
        wartend.data = { ...wartend.data, [fieldId]: ersetzt };
        await enqueueSubmission(wartend);
      }
    }
  } catch (err) {
    console.warn('[SyncDrain] Wartende Einreichung nicht aktualisierbar', err);
  }
}

/**
 * Reicht offene Submissions nach: erst sicherstellen dass keine Photos
 * mehr offen sind, dann Supabase-Update + PDF-Generate + Email-Send.
 */
async function processPendingSubmissions(): Promise<void> {
  let submissions: PendingSubmissionRecord[];
  try {
    submissions = await getAllPendingSubmissions();
  } catch { return; }
  for (const sub of submissions) {
    // Nur einreichen, wenn keine pending Uploads dieses Formulars mehr
    // offen sind — sonst gehen Fotos verloren.
    // Fehlgeschlagene Bilder blockieren nur, solange der Fahrer nicht
    // „Trotzdem abschließen" bestätigt hat — dann gehen ihre Platzhalter
    // aus den Daten raus.
    let blocking = false;
    let fehlgeschlagen: string[] = [];
    try {
      const eigene = (await getUploadQueue()).filter((u) => u.formularId === sub.formularId);
      blocking = eigene.some((u) => !istFehlgeschlagen(u));
      fehlgeschlagen = eigene.filter(istFehlgeschlagen).map((u) => u.id);
    } catch { /* weiter */ }
    if (blocking) continue;
    if (fehlgeschlagen.length > 0 && !sub.fehlendeBilderAkzeptiert) continue;
    if (fehlgeschlagen.length > 0) {
      sub.data = entfernePendingAusDaten(sub.data, fehlgeschlagen).daten;
    }

    try {
      const { data: tplLink, error: linkErr } = await supabase
        .from('ausgefuellte_formulare')
        .update({ daten: sub.data as never, status: 'submitted' })
        .eq('id', sub.formularId)
        .select('template_id, zwischenprotokoll_url, created_at')
        .single();
      if (linkErr || !tplLink) throw linkErr ?? new Error('Submit fehlgeschlagen');

      const { data: tpl, error: tplErr } = await supabase
        .from('formular_templates').select('*').eq('id', tplLink.template_id).single();
      if (tplErr || !tpl) throw tplErr ?? new Error('Template nicht gefunden');
      const template = tpl as unknown as FormularTemplate;
      const formularStub = {
        id: sub.formularId,
        daten: sub.data,
        created_at: tplLink.created_at,
      } as unknown as AusgefuelltesFormular;
      // Zwischenprotokoll bleibt erhalten (wie beim Online-Submit) —
      // sonst ist ein fehlgeschlagener Versand nicht mehr nachholbar.

      // Vorschlags-Pool füttern (Migration 077). Test-Profile filtert die
      // RPC serverseitig aus — hier läuft der Drainer ohne React-Context.
      void merkeAusFormular(template.schema, sub.data, false);
      // Automatische E-Mails (Bestätigung + Schieberegler) — Fehler hier
      // brechen den Submit NICHT ab. Das Ergebnis landet im email_send_log
      // der Formular-Zeile.
      try {
        await runSubmissionEmails(
          template,
          formularStub,
          { submitterEmail: sub.submitterEmail ?? null, fahrerEmail: sub.submitterEmail ?? null },
        );
      } catch (postErr) {
        console.warn('[SyncDrain] Submit-E-Mails fehlgeschlagen', postErr);
      }
      await removePendingSubmission(sub.formularId);
      window.dispatchEvent(new CustomEvent('maja:submission-completed', {
        detail: { formularId: sub.formularId },
      }));
    } catch (err) {
      console.warn('Pending Submission noch nicht zustellbar', err);
      // Im nächsten Tick neu versuchen.
      sub.attempts += 1;
      sub.lastError = err instanceof Error ? err.message : String(err);
      try { await enqueueSubmission(sub); } catch { /* noop */ }
    }
  }
}
