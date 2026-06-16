import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

// ============================================================
// IndexedDB-Schema für Offline-fähiges Arbeiten:
//   form-drafts          → laufende Formular-Entwürfe (State + Bilder)
//   upload-queue         → Fotos, die noch zu OneDrive hochgeladen werden
//   pending-submissions  → Formulare, die bei Empfang noch abgesendet werden
// ============================================================

const DB_NAME = 'maja-logistik-db';
const DB_VERSION = 1;

export interface FormDraftRecord {
  /** id des ausgefuellte_formulare-Eintrags. */
  id: string;
  /** komplette Felddaten (alle FieldSwitch-Werte). */
  data: Record<string, unknown>;
  /** Server-updated_at zum Zeitpunkt des Mergens — falls vorhanden. */
  serverUpdatedAt: string | null;
  /** Lokaler Speicher-Zeitstempel (ms epoch). */
  savedAt: number;
}

export interface UploadQueueItem {
  /** Lokale eindeutige ID des Uploads. */
  id: string;
  /** Zugehöriges Formular (für UI-Status). */
  formularId: string;
  /** Field-ID im Formular (z.B. "foto_front"). */
  fieldId: string;
  /** OneDrive-Ordner für den Upload. */
  folder: string;
  /** Dateiname inkl. Endung. */
  filename: string;
  /** Bild als Blob — wird vor dem Upload aus IDB gelesen. */
  blob: Blob;
  /** Anzahl der bisherigen Fehlversuche. */
  attempts: number;
  /** ms epoch: nicht vor diesem Zeitpunkt erneut versuchen. */
  nextRetryAt: number;
  /** Letzte Fehlermeldung (informativ). */
  lastError: string | null;
}

export interface PendingSubmissionRecord {
  /** id des ausgefuellte_formulare-Eintrags. */
  formularId: string;
  /** Snapshot der Daten zum Submit-Zeitpunkt. */
  data: Record<string, unknown>;
  /** ms epoch — wann der User auf "Einreichen" geklickt hat. */
  queuedAt: number;
  /** Anzahl der bisherigen Versuche. */
  attempts: number;
  /** Letzte Fehlermeldung. */
  lastError: string | null;
  /** E-Mail des einreichenden Nutzers — wird beim Sync als CC ergänzt. */
  submitterEmail?: string | null;
}

interface OfflineDbSchema extends DBSchema {
  'form-drafts': {
    key: string;
    value: FormDraftRecord;
  };
  'upload-queue': {
    key: string;
    value: UploadQueueItem;
    indexes: { 'by-formular': string };
  };
  'pending-submissions': {
    key: string;
    value: PendingSubmissionRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('form-drafts')) {
          db.createObjectStore('form-drafts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('upload-queue')) {
          const store = db.createObjectStore('upload-queue', { keyPath: 'id' });
          store.createIndex('by-formular', 'formularId');
        }
        if (!db.objectStoreNames.contains('pending-submissions')) {
          db.createObjectStore('pending-submissions', { keyPath: 'formularId' });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- form-drafts ----------

export async function getFormDraft(id: string): Promise<FormDraftRecord | null> {
  const db = await getDb();
  return (await db.get('form-drafts', id)) ?? null;
}

/** Alle lokal gespeicherten Entwürfe — für die Recovery-Seite. */
export async function getAllFormDrafts(): Promise<FormDraftRecord[]> {
  const db = await getDb();
  return await db.getAll('form-drafts');
}

export async function saveFormDraft(record: FormDraftRecord): Promise<void> {
  const db = await getDb();
  await db.put('form-drafts', record);
}

export async function deleteFormDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('form-drafts', id);
}

/** Entwürfe älter als `maxAgeMs` löschen — wird beim App-Start aufgerufen. */
export async function cleanupOldDrafts(maxAgeMs: number): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - maxAgeMs;
  const tx = db.transaction('form-drafts', 'readwrite');
  for await (const cursor of tx.store) {
    if (cursor.value.savedAt < cutoff) {
      await cursor.delete();
    }
  }
  await tx.done;
}

// ---------- upload-queue ----------

export async function enqueueUpload(item: UploadQueueItem): Promise<void> {
  const db = await getDb();
  await db.put('upload-queue', item);
}

export async function getUploadQueue(): Promise<UploadQueueItem[]> {
  const db = await getDb();
  return await db.getAll('upload-queue');
}

export async function getUploadsForFormular(formularId: string): Promise<UploadQueueItem[]> {
  const db = await getDb();
  return await db.getAllFromIndex('upload-queue', 'by-formular', formularId);
}

export async function updateUploadQueueItem(item: UploadQueueItem): Promise<void> {
  const db = await getDb();
  await db.put('upload-queue', item);
}

export async function removeFromUploadQueue(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('upload-queue', id);
}

// ---------- pending-submissions ----------

export async function enqueueSubmission(record: PendingSubmissionRecord): Promise<void> {
  const db = await getDb();
  await db.put('pending-submissions', record);
}

export async function getPendingSubmission(formularId: string): Promise<PendingSubmissionRecord | null> {
  const db = await getDb();
  return (await db.get('pending-submissions', formularId)) ?? null;
}

export async function getAllPendingSubmissions(): Promise<PendingSubmissionRecord[]> {
  const db = await getDb();
  return await db.getAll('pending-submissions');
}

export async function removePendingSubmission(formularId: string): Promise<void> {
  const db = await getDb();
  await db.delete('pending-submissions', formularId);
}
