import { useEffect, useRef, useState } from 'react';
import { uploadToOneDrive } from '../../../lib/onedrive';
import { getPhotoUrl } from '../../../lib/photo';
import { processStampImage } from '../../../lib/stampProcessing';
import {
  enqueueUpload, getUploadQueue, removeFromUploadQueue,
  type UploadQueueItem,
} from '../../../lib/offlineDb';
import { useSync } from '../../../sync/SyncContext';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  /** OneDrive-Ordner — Stempel landen unter <folder>/Fotos/ */
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

/**
 * Stempel-Feld (Fahrer-Ansicht): Foto vom Stempel aufnehmen, Hintergrund
 * lokal per Canvas freistellen (siehe lib/stampProcessing), Vorschau auf
 * Karoboden zeigen (damit der transparente Bereich sichtbar ist),
 * Ergebnis durch die normale Upload-Queue in OneDrive ablegen.
 */
export function StampField({ field, value, oneDriveFolder, formularId, onChange, disabled }: Props) {
  const { triggerSync } = useSync();
  const current = asPhoto(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const path = current?.storage_path;
    if (path) {
      getPhotoUrl(path, formularId).then((u) => {
        if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
        createdUrl = u;
        setSignedUrl(u);
      });
    } else {
      // Asynchron, damit der Reset nicht synchron im Effect läuft
      // (react-hooks/set-state-in-effect).
      queueMicrotask(() => { if (!cancelled) setSignedUrl(null); });
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [current?.storage_path, formularId]);

  // Pending aus IDB nachladen (z.B. nach App-Restart).
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

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handleFile(file: File) {
    setError(null);
    setHint(null);
    setBusy(true);
    try {
      const result = await processStampImage(file);
      if (!result.processed) {
        setHint('Automatische Freistellung nicht möglich — Original wird verwendet.');
      }
      const blob = result.blob;
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const filename = `${field.id}.${ext}`;

      // Sofortige lokale Vorschau.
      const localUrl = URL.createObjectURL(blob);
      setLocalPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return localUrl; });

      const path = `${oneDriveFolder.replace(/\/+$/, '')}/Fotos/${filename}`;

      if (navigator.onLine) {
        try {
          await uploadToOneDrive(path, blob);
          onChange({
            storage_path: path,
            mime_type: blob.type,
            size_bytes: blob.size,
          });
          return;
        } catch (err) {
          console.warn('[StampField] Direkter Upload fehlgeschlagen — gehe in Queue', err);
        }
      }

      if (formularId) {
        const id = makeUploadId(formularId, field.id);
        const item: UploadQueueItem = {
          id, formularId, fieldId: field.id,
          folder: oneDriveFolder, filename, blob,
          attempts: 0, nextRetryAt: 0, lastError: null,
        };
        await enqueueUpload(item);
        onChange({
          pending_id: id,
          mime_type: blob.type,
          size_bytes: blob.size,
        });
        triggerSync();
      } else {
        setError('Upload nicht möglich (keine Formular-ID).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stempel-Verarbeitung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (localPreviewUrl) { URL.revokeObjectURL(localPreviewUrl); setLocalPreviewUrl(null); }
    if (current?.pending_id) {
      try { await removeFromUploadQueue(current.pending_id); } catch { /* ignore */ }
    }
    setHint(null);
    onChange(null);
  }

  const previewUrl = localPreviewUrl ?? signedUrl;
  const hasStamp = !!previewUrl;

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>

      <div
        className={`relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border bg-white ${
          hasStamp ? 'border-maja-navy/20' : 'border-2 border-dashed border-maja-navy/30'
        }`}
        style={hasStamp ? checkerboardStyle : undefined}
      >
        {hasStamp ? (
          <img
            src={previewUrl!}
            alt={field.label}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-maja-muted">
            <IconStamp />
            <span className="text-xs font-medium">Noch kein Stempel</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-maja-navy">
            Stempel wird verarbeitet …
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => cameraRef.current?.click()}
          className="btn-secondary text-sm"
        >
          {hasStamp ? 'Neu aufnehmen' : 'Stempel fotografieren'}
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => galleryRef.current?.click()}
          className="btn-secondary text-sm"
        >
          Aus Galerie
        </button>
        {hasStamp && !disabled && !busy && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Entfernen
          </button>
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
          if (f) void handleFile(f);
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
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />

      {hint && (
        <p className="mt-2 text-xs text-maja-muted">{hint}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}

// Karomuster, damit Transparenz im Preview sichtbar ist.
const checkerboardStyle: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%),'
    + 'linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),'
    + 'linear-gradient(45deg, transparent 75%, #e2e8f0 75%),'
    + 'linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

function IconStamp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M5 21h14" />
      <path d="M6 17h12v2H6z" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
      <path d="M7 11h10l-1 6H8z" />
    </svg>
  );
}
