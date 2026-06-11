import { useEffect, useRef, useState } from 'react';
import { uploadToOneDrive } from '../../../lib/onedrive';
import { getPhotoUrl } from '../../../lib/photo';
import { processStampImage } from '../../../lib/stampProcessing';
import {
  enqueueUpload, getUploadQueue, removeFromUploadQueue,
  type UploadQueueItem,
} from '../../../lib/offlineDb';
import { useSync } from '../../../sync/SyncContext';
import { ConfirmDialog } from '../../ConfirmDialog';
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
 * Stempel-Feld (Fahrer-Ansicht). Eingeklappt: nur ein Toggle „Stempel
 * <Label> erfassen". Aufgeklappt: Aufnahme-Buttons + Vorschau auf
 * Karoboden. Beim Deaktivieren mit aufgenommenem Stempel wird der
 * Verwerfen vor Rückfrage abgesichert.
 */
export function StampField({ field, value, oneDriveFolder, formularId, onChange, disabled }: Props) {
  const { triggerSync } = useSync();
  const current = asPhoto(value);
  const hasValue = !!current;
  const [expanded, setExpanded] = useState<boolean>(hasValue);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Sobald ein Wert nachträglich (Restore aus Draft etc.) auftaucht,
  // Toggle automatisch aufklappen.
  useEffect(() => {
    if (!hasValue) return;
    queueMicrotask(() => setExpanded(true));
  }, [hasValue]);

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

  async function discardStamp() {
    if (localPreviewUrl) { URL.revokeObjectURL(localPreviewUrl); setLocalPreviewUrl(null); }
    if (current?.pending_id) {
      try { await removeFromUploadQueue(current.pending_id); } catch { /* ignore */ }
    }
    setHint(null);
    onChange(null);
  }

  function handleToggle(next: boolean) {
    if (disabled || busy) return;
    if (next) {
      setExpanded(true);
      return;
    }
    // Toggle aus → wenn ein Stempel da ist, vorher Rückfrage.
    if (hasValue) {
      setConfirmDiscard(true);
      return;
    }
    setExpanded(false);
  }

  const previewUrl = localPreviewUrl ?? signedUrl;
  const hasStamp = !!previewUrl;
  const toggleLabel = `Stempel ${field.label} erfassen`;

  return (
    <div className="space-y-2 rounded-lg border border-maja-navy/10 p-3">
      <label className="flex items-center gap-3 text-sm">
        <span
          role="switch"
          aria-checked={expanded}
          tabIndex={disabled ? -1 : 0}
          onClick={() => handleToggle(!expanded)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              handleToggle(!expanded);
            }
          }}
          className={
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition '
            + (expanded
              ? 'bg-maja-accent border-maja-accent dark:bg-blue-500 dark:border-blue-400'
              : 'bg-maja-navy/20 border-maja-navy/30 dark:bg-slate-600 dark:border-slate-500')
            + (disabled ? ' opacity-50 cursor-not-allowed' : '')
          }
        >
          <span
            className={
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition '
              + (expanded ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </span>
        <span className="font-medium text-maja-ink">
          {toggleLabel}
          {field.required && <span className="text-red-600"> *</span>}
        </span>
      </label>

      {expanded && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-2">
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
          </div>

          {(hasStamp || busy) && (
            <div
              className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-maja-navy/20 bg-white"
              style={hasStamp ? checkerboardStyle : undefined}
            >
              {hasStamp && (
                <img
                  src={previewUrl!}
                  alt={field.label}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              )}
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-maja-navy">
                  Stempel wird verarbeitet …
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
        <p className="text-xs text-maja-muted">{hint}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Aufgenommenen Stempel verwerfen?"
          message="Der aktuell erfasste Stempel wird entfernt. Diese Aktion kann nicht rückgängig gemacht werden."
          confirmLabel="Ja, verwerfen"
          cancelLabel="Nein, behalten"
          destructive
          onConfirm={async () => {
            await discardStamp();
            setConfirmDiscard(false);
            setExpanded(false);
          }}
          onClose={() => setConfirmDiscard(false)}
        />
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
