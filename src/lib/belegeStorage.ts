// Persistenter Beleg-Speicher in IndexedDB. Belege überleben damit
// Reiter-Wechsel und Tab-Refreshs; sie werden erst durch einen
// expliziten "Belege zurücksetzen"-Klick (oder durch removeBeleg /
// updateBeleg) entfernt. Blob-Daten landen unkomprimiert im
// Object-Store — die Pipeline komprimiert bereits per
// browser-image-compression vorher.

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'maja-belege';
const STORE   = 'belege';
const META    = 'meta';

interface BelegeDb {
  belege: {
    key: string;
    value: BelegRecord;
    indexes: { 'by-position': number };
  };
  meta: {
    key: string;
    value: { value: unknown };
  };
}

export interface BelegRecord {
  id: string;
  position: number;
  blob: Blob;
  /** Quelle des Belegs — nur zur Diagnose / Anzeige. */
  source: 'manuell' | 'pdf-seite' | 'email-anhang';
  /** Original-Dateiname (z.B. zur Anzeige im Tooltip). */
  name: string | null;
  created_at: number;
}

let dbPromise: Promise<IDBPDatabase<BelegeDb>> | null = null;

function getDb(): Promise<IDBPDatabase<BelegeDb>> {
  if (!dbPromise) {
    dbPromise = openDB<BelegeDb>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by-position', 'position');
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
        }
      },
    });
  }
  return dbPromise;
}

export async function listBelege(): Promise<BelegRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, 'by-position');
  return all.sort((a, b) => a.position - b.position);
}

export async function addBelege(
  blobs: Array<{ blob: Blob; source: BelegRecord['source']; name?: string | null }>,
): Promise<BelegRecord[]> {
  if (blobs.length === 0) return [];
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const idx = tx.store.index('by-position');
  // Höchste Position holen — neue Belege ans Ende anhängen.
  let maxPos = -1;
  const cursor = await idx.openCursor(null, 'prev');
  if (cursor) maxPos = cursor.value.position;
  const out: BelegRecord[] = [];
  for (let i = 0; i < blobs.length; i += 1) {
    const rec: BelegRecord = {
      id: makeId(),
      position: maxPos + 1 + i,
      blob: blobs[i].blob,
      source: blobs[i].source,
      name: blobs[i].name ?? null,
      created_at: Date.now(),
    };
    await tx.store.put(rec);
    out.push(rec);
  }
  await tx.done;
  return out;
}

export async function updateBelegBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE, id);
  if (!existing) return;
  existing.blob = blob;
  await db.put(STORE, existing);
}

export async function removeBeleg(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function clearBelege(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

/**
 * Schreibt eine komplette, neue Reihenfolge in den Store. Bestehende
 * Einträge bleiben erhalten (Blobs werden nicht neu hochgeladen), nur
 * die position-Spalte wird auf den neuen Index gesetzt.
 */
export async function reorderBelege(ids: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (let i = 0; i < ids.length; i += 1) {
    const rec = await tx.store.get(ids[i]);
    if (!rec) continue;
    rec.position = i;
    await tx.store.put(rec);
  }
  await tx.done;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Kennzeichen-Overlay (Aufgabe 2): Text + relative Position als
// einfacher Meta-Key. Wird beim Render der Vorschau UND beim PDF-Export
// angewendet.
// ============================================================

export interface KennzeichenOverlay {
  text: string;
  /** Position in Prozent (0..100) vom linken bzw. oberen Rand des Bildes. */
  position: { x: number; y: number };
}

const KENNZEICHEN_META_KEY = 'kennzeichen-overlay';
const DEFAULT_OVERLAY: KennzeichenOverlay = {
  text: '',
  position: { x: 4, y: 3 },
};

export async function loadKennzeichenOverlay(): Promise<KennzeichenOverlay> {
  try {
    const db = await getDb();
    const stored = await db.get(META, KENNZEICHEN_META_KEY);
    const raw = stored?.value;
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<KennzeichenOverlay>;
      return {
        text: typeof r.text === 'string' ? r.text : '',
        position: {
          x: typeof r.position?.x === 'number' ? r.position.x : DEFAULT_OVERLAY.position.x,
          y: typeof r.position?.y === 'number' ? r.position.y : DEFAULT_OVERLAY.position.y,
        },
      };
    }
  } catch (err) {
    console.warn('[belegeStorage.loadKennzeichenOverlay]', err);
  }
  return DEFAULT_OVERLAY;
}

export async function saveKennzeichenOverlay(overlay: KennzeichenOverlay): Promise<void> {
  try {
    const db = await getDb();
    await db.put(META, { value: overlay }, KENNZEICHEN_META_KEY);
  } catch (err) {
    console.warn('[belegeStorage.saveKennzeichenOverlay]', err);
  }
}
