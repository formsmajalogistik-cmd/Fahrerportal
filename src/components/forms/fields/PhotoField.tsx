import { useEffect, useRef, useState } from 'react';
import { getPhotoUrl, uploadPhoto } from '../../../lib/photo';
import type { FormField, PhotoValue } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  userId: string;
  formularId: string;
  onChange: (v: PhotoValue | null) => void;
  disabled?: boolean;
}

function asPhoto(v: unknown): PhotoValue | null {
  if (v && typeof v === 'object' && 'storage_path' in v) return v as PhotoValue;
  return null;
}

export function PhotoField({ field, value, userId, formularId, onChange, disabled }: Props) {
  const current = asPhoto(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (current?.storage_path) {
      getPhotoUrl(current.storage_path).then((u) => { if (!cancelled) setPreviewUrl(u); });
    } else {
      setPreviewUrl(null);
    }
    return () => { cancelled = true; };
  }, [current?.storage_path]);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const path = await uploadPhoto(file, userId, formularId, field.id);
      onChange({ storage_path: path, mime_type: 'image/jpeg', size_bytes: file.size });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

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
            ref={inputRef}
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
          <button
            type="button"
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading}
          >
            {uploading ? 'Hochladen …' : current ? 'Ersetzen' : 'Foto aufnehmen'}
          </button>
          {current && !disabled && (
            <button
              type="button"
              className="text-sm font-medium text-red-600 hover:underline"
              onClick={() => onChange(null)}
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
