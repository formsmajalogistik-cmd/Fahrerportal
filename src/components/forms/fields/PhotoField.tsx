import { useEffect, useRef, useState } from 'react';
import { compressImage, downloadFile, getPhotoUrl, uploadPhotoToOneDrive } from '../../../lib/photo';
import { useAuth } from '../../../auth/AuthContext';
import { ActionSheet } from '../../ActionSheet';
import { useLongPress } from '../../../lib/useLongPress';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  /** OneDrive-Ordner des Formulars (z.B. "Maja-Logistik/Formulare/2026-05/…"). */
  oneDriveFolder: string;
  onChange: (v: PhotoValue | null) => void;
  disabled?: boolean;
}

function asPhoto(v: unknown): PhotoValue | null {
  if (v && typeof v === 'object' && 'storage_path' in v) return v as PhotoValue;
  return null;
}

export function PhotoField({ field, value, oneDriveFolder, onChange, disabled }: Props) {
  const { profile } = useAuth();
  const current = asPhoto(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-Preview (objectURL) zeigt das Foto sofort an, noch während im
  // Hintergrund komprimiert + hochgeladen wird.
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState<'add' | 'edit' | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (current?.storage_path) {
      getPhotoUrl(current.storage_path).then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
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

  // ObjectURL nach Wechsel wieder freigeben
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handleFile(file: File, fromCamera: boolean) {
    setError(null);
    // Sofortige lokale Vorschau aus dem Original — der User sieht sein Foto,
    // bevor Komprimierung und Upload abgeschlossen sind.
    const localUrl = URL.createObjectURL(file);
    setLocalPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return localUrl; });

    setUploading(true);
    try {
      const compressed = await compressImage(file);
      if (fromCamera && profile?.save_to_gallery) {
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        await downloadFile(compressed, `${field.id}_${ts}.jpg`);
      }
      const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
      const filename = `${field.id}.${ext}`;
      const path = await uploadPhotoToOneDrive(compressed, oneDriveFolder, filename);
      onChange({ storage_path: path, mime_type: compressed.type, size_bytes: compressed.size });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  function handleDelete() {
    if (localPreviewUrl) { URL.revokeObjectURL(localPreviewUrl); setLocalPreviewUrl(null); }
    onChange(null);
  }

  const previewUrl = localPreviewUrl ?? signedUrl;
  const hasPhoto = !!previewUrl;

  // Tap → "Hinzufügen"-Sheet (nur wenn leer). Long-Press → Edit-Sheet.
  const longPress = useLongPress(
    () => { if (!disabled && hasPhoto) setSheetOpen('edit'); },
    () => { if (!disabled && !hasPhoto) setSheetOpen('add'); },
  );

  return (
    <div>
      <label className="label">
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
        {...longPress.handlers}
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
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-maja-navy">
            Hochladen …
          </div>
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
          { label: 'Foto löschen', onClick: handleDelete, destructive: true, icon: <IconTrash /> },
        ]}
      />
    </div>
  );
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
