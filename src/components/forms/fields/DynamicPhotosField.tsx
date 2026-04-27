import { useEffect, useRef, useState } from 'react';
import { compressImage, downloadFile, getPhotoUrl, uploadPhoto } from '../../../lib/photo';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../auth/AuthContext';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  userId: string;
  formularId: string;
  onChange: (v: PhotoValue[]) => void;
  disabled?: boolean;
}

function asArray(v: unknown): PhotoValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is PhotoValue =>
    !!x && typeof x === 'object' && typeof (x as { storage_path?: unknown }).storage_path === 'string'
  );
}

export function DynamicPhotosField({
  field, value, userId, formularId, onChange, disabled,
}: Props) {
  const { profile } = useAuth();
  const items = asArray(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function addPhoto(file: File, fromCamera: boolean) {
    setError(null);
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      if (fromCamera && profile?.save_to_gallery) {
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        downloadFile(compressed, `${field.id}_${items.length + 1}_${ts}.jpg`);
      }
      const slot = `${field.id}_${Date.now()}_${items.length}`;
      const path = await uploadPhoto(compressed, userId, formularId, slot);
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

  async function removeAt(idx: number) {
    const removed = items[idx];
    onChange(items.filter((_, i) => i !== idx));
    if (removed?.storage_path) {
      await supabase.storage.from('formular-fotos').remove([removed.storage_path]).catch(() => {});
    }
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <p className="mb-2 text-xs text-maja-muted">
        Klicke auf einen der Buttons, um beliebig viele Fotos zu erfassen.
        Die Fotos werden im PDF der Reihe nach in die vorgesehenen Platzhalter
        eingesetzt.
      </p>

      {items.length > 0 && (
        <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((p, i) => (
            <li key={`${p.storage_path}-${i}`}>
              <DynamicPhotoTile
                photo={p}
                index={i}
                onRemove={() => void removeAt(i)}
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
      <div className="flex flex-wrap gap-2">
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
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}

function DynamicPhotoTile({
  photo, index, onRemove, disabled,
}: {
  photo: PhotoValue;
  index: number;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPhotoUrl(photo.storage_path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [photo.storage_path]);

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
