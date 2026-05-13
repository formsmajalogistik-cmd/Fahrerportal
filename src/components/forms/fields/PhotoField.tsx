import { useEffect, useRef, useState } from 'react';
import { compressImage, downloadFile, getPhotoUrl, uploadPhotoToOneDrive } from '../../../lib/photo';
import { useAuth } from '../../../auth/AuthContext';
import { ActionSheet } from '../../ActionSheet';
import { useLongPress } from '../../../lib/useLongPress';
import {
  enqueueUpload, getUploadQueue, removeFromUploadQueue,
  type UploadQueueItem,
} from '../../../lib/offlineDb';
import { useSync } from '../../../sync/SyncContext';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  /** OneDrive-Ordner des Formulars (z.B. "Maja-Logistik/Formulare/2026-05/…"). */
  oneDriveFolder: string;
  /** Formular-Instanz-ID — Upload-Queue-Einträge werden darüber zugeordnet. */
  formularId?: string;
  onChange: (v: PhotoValue | null) => void;
  disabled?: boolean;
}

function asPhoto(v: unknown): PhotoValue | null {
  if (v && typeof v === 'object' && ('storage_path' in v || 'pending_id' in v)) {
    return v as PhotoValue;
  }
  return null;
}

function makeUploadId(formularId: string, fieldId: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${formularId}:${fieldId}:${Date.now().toString(36)}-${rand}`;
}

export function PhotoField({ field, value, oneDriveFolder, formularId, onChange, disabled }: Props) {
  const { profile } = useAuth();
  const { triggerSync, online } = useSync();
  const current = asPhoto(value);
  const isPending = !!current?.pending_id;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-Preview (objectURL) — sofortige Vorschau aus dem aufgenommenen
  // bzw. aus IDB nachgeladenen Blob.
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState<'add' | 'edit' | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Online-Bild laden, wenn storage_path gesetzt ist.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (current?.storage_path) {
      getPhotoUrl(current.storage_path).then((u) => {
        if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
        createdUrl = u;
        setSignedUrl(u);
      });
    } else {
      setSignedUrl(null);
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [current?.storage_path]);

  // Pending-Bild aus IDB nachladen — Preview-Blob für Felder, deren
  // Upload noch in der Queue steht (z.B. nach App-Restart, schwarzer
  // Bildschirm-Recovery).
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (current?.pending_id) {
      void getUploadQueue().then((items) => {
        if (cancelled) return;
        const item = items.find((i) => i.id === current.pending_id);
        if (item) {
          createdUrl = URL.createObjectURL(item.blob);
          setLocalPreviewUrl(createdUrl);
        }
      });
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [current?.pending_id]);

  // ObjectURL nach Wechsel wieder freigeben
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handleFile(file: File, fromCamera: boolean) {
    setError(null);
    // Sofortige lokale Vorschau aus dem Original.
    const localUrl = URL.createObjectURL(file);
    setLocalPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return localUrl; });

    setUploading(true);
    let compressed: File;
    try {
      compressed = await compressImage(file);
    } catch {
      compressed = file;
    }
    if (fromCamera && profile?.save_to_gallery) {
      const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      try { await downloadFile(compressed, `${field.id}_${ts}.jpg`); } catch { /* ignore */ }
    }
    const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `${field.id}.${ext}`;

    // Online + Verbindung intakt → direkter Upload.
    if (navigator.onLine) {
      try {
        const path = await uploadPhotoToOneDrive(compressed, oneDriveFolder, filename);
        onChange({ storage_path: path, mime_type: compressed.type, size_bytes: compressed.size });
        setUploading(false);
        return;
      } catch (err) {
        console.warn('[PhotoField] Direkter Upload fehlgeschlagen — gehe in Queue', err);
      }
    }

    // Offline oder Upload fehlgeschlagen → in IDB-Queue legen.
    if (formularId) {
      const id = makeUploadId(formularId, field.id);
      const item: UploadQueueItem = {
        id, formularId, fieldId: field.id,
        folder: oneDriveFolder, filename, blob: compressed,
        attempts: 0, nextRetryAt: 0, lastError: null,
      };
      try {
        await enqueueUpload(item);
        onChange({
          pending_id: id,
          mime_type: compressed.type,
          size_bytes: compressed.size,
        });
        triggerSync();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Konnte Bild lokal nicht speichern');
      }
    } else {
      setError('Upload nicht möglich (keine Formular-ID).');
    }
    setUploading(false);
  }

  async function handleDelete() {
    if (localPreviewUrl) { URL.revokeObjectURL(localPreviewUrl); setLocalPreviewUrl(null); }
    if (current?.pending_id) {
      try { await removeFromUploadQueue(current.pending_id); } catch { /* ignore */ }
    }
    onChange(null);
  }

  const previewUrl = localPreviewUrl ?? signedUrl;
  const hasPhoto = !!previewUrl;

  const longPress = useLongPress({
    onLongPress: () => {
      if (disabled || !hasPhoto) return;
      setSheetOpen('edit');
    },
    onClick: () => {
      if (disabled) return;
      if (!hasPhoto) setSheetOpen('add');
    },
  });

  return (
    <div>
      <label className="label min-h-[2.5rem] leading-tight">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={hasPhoto ? `${field.label} — Foto, lang drücken zum Ändern` : `${field.label} — Foto hinzufügen`}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSheetOpen(hasPhoto ? 'edit' : 'add');
          }
        }}
        {...longPress.bind}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        className={`relative flex aspect-[4/3] w-full select-none items-center justify-center overflow-hidden rounded-lg border bg-maja-light transition ${
          hasPhoto ? 'border-maja-navy/20' : 'border-2 border-dashed border-maja-navy/30'
        } ${disabled ? 'opacity-60' : 'cursor-pointer'} ${longPress.pressing ? 'scale-[0.97] opacity-80' : ''}`}
      >
        {hasPhoto ? (
          <img src={previewUrl!} alt={field.label} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-maja-muted">
            <IconCamera />
            <span className="text-xs font-medium">Foto hinzufügen</span>
          </div>
        )}
        {/* Upload-Status-Indikator unten rechts */}
        {hasPhoto && (
          <UploadBadge
            uploading={uploading}
            pending={isPending}
            online={online}
            uploaded={!!current?.storage_path && !isPending}
          />
        )}
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f, true);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f, false);
          e.target.value = '';
        }}
      />

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
      )}

      <ActionSheet
        open={sheetOpen === 'add'}
        onClose={() => setSheetOpen(null)}
        title={field.label}
        actions={[
          { label: 'Foto aufnehmen', onClick: () => cameraRef.current?.click(), icon: <IconCamera /> },
          { label: 'Aus Galerie wählen', onClick: () => galleryRef.current?.click(), icon: <IconImage /> },
        ]}
      />
      <ActionSheet
        open={sheetOpen === 'edit'}
        onClose={() => setSheetOpen(null)}
        title={field.label}
        actions={[
          { label: 'Foto ersetzen', onClick: () => cameraRef.current?.click(), icon: <IconCamera /> },
          { label: 'Aus Galerie wählen', onClick: () => galleryRef.current?.click(), icon: <IconImage /> },
          { label: 'Foto löschen', onClick: () => void handleDelete(), destructive: true, icon: <IconTrash /> },
        ]}
      />
    </div>
  );
}

function UploadBadge({ uploading, pending, uploaded, online }: {
  uploading: boolean; pending: boolean; uploaded: boolean; online: boolean;
}) {
  if (uploading) {
    return (
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-maja-navy shadow">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        Upload läuft
      </span>
    );
  }
  if (pending) {
    return (
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-maja-navy shadow">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        {online ? 'Warte auf Upload' : 'Offline'}
      </span>
    );
  }
  if (uploaded) {
    return (
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-maja-navy shadow">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        Hochgeladen
      </span>
    );
  }
  return null;
}

function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function IconImage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m3 17 5-5 5 5 3-3 5 5" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />
    </svg>
  );
}
