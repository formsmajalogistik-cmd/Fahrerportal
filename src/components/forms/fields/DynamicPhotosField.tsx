import { useEffect, useRef, useState } from 'react';
import { compressImage, downloadFile, getPhotoUrl, uploadPhotoToOneDrive } from '../../../lib/photo';
import { useAuth } from '../../../auth/AuthContext';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  /** OneDrive-Folder des Formulars; Photos landen unter <folder>/Fotos/ */
  oneDriveFolder: string;
  /** Formular-Instanz-ID — für die Foto-Vorschau via Download-Proxy nötig. */
  formularId?: string;
  onChange: (v: PhotoValue[]) => void;
  disabled?: boolean;
}

function asArray(v: unknown): PhotoValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is PhotoValue =>
    !!x && typeof x === 'object' && typeof (x as { storage_path?: unknown }).storage_path === 'string'
  );
}

// Sehr hohes Limit — die einzelne PDF-Seite wird beim Export automatisch
// dupliziert, sobald die konfigurierten Slot-Plätze auf einer Seite
// überlaufen. 100 deckt alle realistischen Anwendungsfälle ab und schützt
// trotzdem vor versehentlichen Massen-Uploads.
const MAX_DYNAMIC_PHOTOS = 100;

export function DynamicPhotosField({
  field, value, oneDriveFolder, formularId, onChange, disabled,
}: Props) {
  const { profile } = useAuth();
  const items = asArray(value);
  const limitReached = items.length >= MAX_DYNAMIC_PHOTOS;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function addPhoto(file: File, fromCamera: boolean) {
    setError(null);
    if (items.length >= MAX_DYNAMIC_PHOTOS) {
      setError(`Maximum von ${MAX_DYNAMIC_PHOTOS} Fotos bereits erreicht.`);
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      if (fromCamera && profile?.save_to_gallery) {
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        downloadFile(compressed, `${field.id}_${items.length + 1}_${ts}.jpg`);
      }
      const ext = compressed.type === 'image/jpeg' ? 'jpg' : 'png';
      const filename = `${field.id}_${String(items.length + 1).padStart(3, '0')}_${Date.now()}.${ext}`;
      const path = await uploadPhotoToOneDrive(compressed, oneDriveFolder, filename);
      const next: PhotoValue = {
        storage_path: path,
        mime_type: compressed.type,
        size_bytes: compressed.size,
      };
      onChange([...items, next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  function removeAt(idx: number) {
    // Eintrag aus dem State nehmen — die Datei in OneDrive bleibt liegen
    // (Cleanup könnte später als Hintergrund-Job laufen).
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <p className="mb-2 text-xs text-maja-muted">
        Klicke auf einen der Buttons, um beliebig viele Fotos zu erfassen.
        Die Fotos werden im PDF der Reihe nach in die vorgesehenen Platzhalter
        eingesetzt. Bei mehr Fotos als Slots auf der PDF-Seite wird die Seite
        beim Export automatisch dupliziert.
      </p>

      {items.length > 0 && (
        <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((p, i) => (
            <li key={`${p.storage_path}-${i}`}>
              <DynamicPhotoTile
                photo={p}
                index={i}
                formularId={formularId}
                onRemove={() => removeAt(i)}
                disabled={disabled}
              />
            </li>
          ))}
        </ul>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addPhoto(f, true);
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
          if (f) void addPhoto(f, false);
          e.target.value = '';
        }}
      />
      {limitReached ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Maximum von {MAX_DYNAMIC_PHOTOS} Fotos erreicht. Entferne ein Foto,
          um ein weiteres hinzuzufügen.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled || uploading}
          >
            {uploading ? 'Hochladen …' : '+ Foto aufnehmen'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => galleryRef.current?.click()}
            disabled={disabled || uploading}
          >
            Aus Galerie wählen
          </button>
          <span className="text-xs text-maja-muted">
            {items.length} / {MAX_DYNAMIC_PHOTOS}
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}

function DynamicPhotoTile({
  photo, index, formularId, onRemove, disabled,
}: {
  photo: PhotoValue;
  index: number;
  formularId?: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (!photo.storage_path) { setUrl(null); return; }
    getPhotoUrl(photo.storage_path, formularId).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      if (!u) {
        console.warn('[Bild-Vorschau] dynamic photo Laden fehlgeschlagen', {
          path: photo.storage_path, formularId,
        });
      }
      createdUrl = u; setUrl(u);
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photo.storage_path, formularId]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-maja-navy/20 bg-maja-light">
      <div className="aspect-[4/3] w-full">
        {url ? (
          <img src={url} alt={`Foto ${index + 1}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-maja-muted">
            Lade …
          </div>
        )}
      </div>
      <div className="absolute left-1 top-1 rounded bg-maja-navy/80 px-1.5 text-[10px] font-semibold text-white">
        #{index + 1}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 rounded bg-red-600/90 px-1.5 text-[10px] font-semibold text-white hover:bg-red-700"
        >
          ×
        </button>
      )}
    </div>
  );
}
