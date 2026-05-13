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
  cleanupOldDrafts,
  enqueueSubmission,
  getAllPendingSubmissions,
  getFormDraft,
  getUploadQueue,
  removeFromUploadQueue,
  removePendingSubmission,
  saveFormDraft,
  updateUploadQueueItem,
  type UploadQueueItem,
  type PendingSubmissionRecord,
} from '../lib/offlineDb';
import { uploadToOneDrive } from '../lib/onedrive';
import { supabase } from '../lib/supabase';
import { generateAndUploadFormPdfs, sendTemplateEmail } from '../lib/pdfGenerate';
import type { FormularTemplate, PhotoValue } from '../types/db';

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

interface SyncContextValue {
  online: boolean;
  pendingUploads: number;
  pendingSubmissions: number;
  syncing: boolean;
  triggerSync: () => void;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const TICK_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = (attempts: number) => Math.min(120_000, 30_000 * Math.pow(2, attempts));
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const [pendingUploads, setPendingUploads] = useState(0);
  const [pendingSubmissions, setPendingSubmissions] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const runningRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([getUploadQueue(), getAllPendingSubmissions()]);
      setPendingUploads(u.length);
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

  // Initial: alte Drafts aufräumen, Zähler laden.
  useEffect(() => {
    void cleanupOldDrafts(DRAFT_TTL_MS).catch(() => { /* noop */ });
    void refreshCounts();
  }, [refreshCounts]);

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

  const value = useMemo<SyncContextValue>(() => ({
    online, pendingUploads, pendingSubmissions, syncing, triggerSync,
  }), [online, pendingUploads, pendingSubmissions, syncing, triggerSync]);

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
  for (const item of items) {
    if (item.nextRetryAt > now) continue;
    try {
      const fullPath = `${item.folder.replace(/\/+$/, '')}/Fotos/${item.filename}`;
      await uploadToOneDrive(fullPath, item.blob);
      const newValue: PhotoValue = {
        storage_path: fullPath,
        mime_type: item.blob.type || 'image/jpeg',
        size_bytes: item.blob.size,
      };
      await applyUploadSuccessToDraft(item.formularId, item.fieldId, newValue);
      await removeFromUploadQueue(item.id);
      // Page-Komponente (falls mounted) auf neuen Draft hinweisen.
      window.dispatchEvent(new CustomEvent('maja:draft-updated', {
        detail: { formularId: item.formularId },
      }));
    } catch (err) {
      const attempts = item.attempts + 1;
      const lastError = err instanceof Error ? err.message : String(err);
      if (attempts >= MAX_ATTEMPTS) {
        // Aufgeben — Eintrag bleibt sichtbar, aber wird nicht weiter
        // versucht. Der Admin kann ihn manuell verwerfen, sobald wir
        // dafür UI haben.
        await updateUploadQueueItem({ ...item, attempts, lastError, nextRetryAt: Number.MAX_SAFE_INTEGER });
      } else {
        await updateUploadQueueItem({
          ...item, attempts, lastError, nextRetryAt: now + BACKOFF_MS(attempts),
        });
      }
    }
  }
}

async function applyUploadSuccessToDraft(
  formularId: string,
  fieldId: string,
  newValue: PhotoValue,
): Promise<void> {
  const draft = await getFormDraft(formularId);
  if (!draft) return;
  // Wenn das Feld ein dynamic_photos-Feld ist (Array), suchen wir
  // den passenden Slot. Sonst direkter Setzen.
  const current = (draft.data as Record<string, unknown>)[fieldId];
  if (Array.isArray(current)) {
    const next = current.map((slot) => {
      if (slot && typeof slot === 'object'
        && (slot as { pending_id?: string }).pending_id
        && (slot as { pending_id?: string }).pending_id === `${formularId}:${fieldId}`) {
        return newValue;
      }
      return slot;
    });
    draft.data[fieldId] = next;
  } else {
    draft.data[fieldId] = newValue;
  }
  draft.savedAt = Date.now();
  await saveFormDraft(draft);
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
    let blocking = false;
    try {
      const uploads = await getUploadQueue();
      blocking = uploads.some((u) => u.formularId === sub.formularId);
    } catch { /* weiter */ }
    if (blocking) continue;

    try {
      const { data: tplLink, error: linkErr } = await supabase
        .from('ausgefuellte_formulare')
        .update({ daten: sub.data as never, status: 'submitted' })
        .eq('id', sub.formularId)
        .select('template_id')
        .single();
      if (linkErr || !tplLink) throw linkErr ?? new Error('Submit fehlgeschlagen');

      const { data: tpl, error: tplErr } = await supabase
        .from('formular_templates').select('*').eq('id', tplLink.template_id).single();
      if (tplErr || !tpl) throw tplErr ?? new Error('Template nicht gefunden');
      const template = tpl as unknown as FormularTemplate;
      const formularStub = { id: sub.formularId, daten: sub.data } as never;
      try {
        const generated = await generateAndUploadFormPdfs(template, formularStub);
        await sendTemplateEmail(template, formularStub, generated);
      } catch (postErr) {
        // PDF/Email-Fehler nach erfolgtem Submit nur loggen — Status
        // ist bereits "submitted", Admin kann manuell nachsenden.
        console.warn('PDF/Email nach Offline-Submit fehlgeschlagen', postErr);
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
