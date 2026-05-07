import { useEffect, useRef, useState } from 'react';
import { compressImage, downloadFile, getPhotoUrl, uploadPhotoToOneDrive } from '../../../lib/photo';
import { useAuth } from '../../../auth/AuthContext';
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
      // Wenn der Nutzer in seinem Profil aktiviert hat, dass Aufnahmen auch
      // in der Galerie landen sollen, triggern wir nach dem Komprimieren
      // einen Browser-Download (Galerie-Bilder kommen über die Downloads).
      if (fromCamera && profile?.save_to_gallery) {
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        // Awaiten — auf iOS startet Web Share einen System-Dialog. Der Upload
        // erst NACH dem Share-Versuch fortsetzen, sonst friert der Dialog ein.
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

  const previewUrl = localPreviewUrl ?? signedUrl;

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-32 w-48 items-center justify-center overflow-hidden rounded-lg border border-dashed border-maja-navy/30 bg-maja-light">
          {previewUrl ? (
            <img src={previewUrl} alt={field.label} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-maja-muted">Kein Foto</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
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
          <button
            type="button"
            className="btn-primary"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled || uploading}
          >
            {uploading ? 'Hochladen …' : 'Foto aufnehmen'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => galleryRef.current?.click()}
            disabled={disabled || uploading}
          >
            Aus Galerie wählen
          </button>
          {current && !disabled && (
            <button
              type="button"
              className="text-sm font-medium text-red-600 hover:underline"
              onClick={() => {
                if (localPreviewUrl) { URL.revokeObjectURL(localPreviewUrl); setLocalPreviewUrl(null); }
                onChange(null);
              }}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}
