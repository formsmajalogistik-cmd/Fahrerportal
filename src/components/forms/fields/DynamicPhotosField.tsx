import { useEffect, useRef, useState } from 'react';
import { getPhotoUrl } from '../../../lib/photo';
import { getUploadQueue, removeFromUploadQueue } from '../../../lib/offlineDb';
import { zusatzbildSpeichern } from '../../../lib/zusatzbildUpload';
import { zusatzbilderAusWert } from '../../../lib/pendingFoto';
import { useSync } from '../../../sync/SyncContext';
import type { FormField, PhotoValue } from '../../../types/db';
import type { FeldWert } from '../FormRenderer';

interface Props {
  field: FormField;
  value: unknown;
  /** OneDrive-Folder des Formulars; Photos landen unter <folder>/Fotos/ */
  oneDriveFolder: string;
  /** Formular-Instanz-ID — für die Foto-Vorschau via Download-Proxy nötig. */
  formularId?: string;
  onChange: (v: FeldWert) => void;
  disabled?: boolean;
}

function kennung(p: PhotoValue): string {
  return p.storage_path ?? p.pending_id ?? '';
}

// Sehr hohes Limit — die einzelne PDF-Seite wird beim Export automatisch
// dupliziert, sobald die konfigurierten Slot-Plätze auf einer Seite
// überlaufen. 100 deckt alle realistischen Anwendungsfälle ab und schützt
// trotzdem vor versehentlichen Massen-Uploads.
const MAX_DYNAMIC_PHOTOS = 100;

export function DynamicPhotosField({
  field, value, oneDriveFolder, formularId, onChange, disabled,
}: Props) {
  const { triggerSync } = useSync();
  const items = zusatzbilderAusWert(value);
  const limitReached = items.length >= MAX_DYNAMIC_PHOTOS;
  // Zähler statt Ja/Nein: mehrere Aufnahmen dürfen parallel laufen.
  const [laufend, setLaufend] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function addPhoto(file: File) {
    setError(null);
    if (items.length >= MAX_DYNAMIC_PHOTOS) {
      setError(`Maximum von ${MAX_DYNAMIC_PHOTOS} Fotos bereits erreicht.`);
      return;
    }
    setLaufend((n) => n + 1);
    try {
      const { wert, inWarteschlange } = await zusatzbildSpeichern(file, {
        feldId: field.id, oneDriveFolder, formularId, quelle: 'feld',
      });
      // Funktional anhängen: `items` ist der Stand vom Beginn des Uploads.
      // Damit würde ein zweites, parallel fertig gewordenes Foto wieder
      // verschwinden.
      onChange((vorher: unknown) => [...zusatzbilderAusWert(vorher), wert]);
      if (inWarteschlange) triggerSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setLaufend((n) => Math.max(0, n - 1));
    }
  }

  function remove(p: PhotoValue) {
    // Nach Kennung entfernen, nicht nach Position — die Position kann sich
    // durch einen parallel fertig gewordenen Upload verschoben haben.
    // Die Datei in OneDrive bleibt liegen; ein wartender Upload wird
    // abgebrochen.
    const k = kennung(p);
    onChange((vorher: unknown) => zusatzbilderAusWert(vorher).filter((x) => kennung(x) !== k));
    if (p.pending_id) void removeFromUploadQueue(p.pending_id).catch(() => {});
  }

  const uploading = laufend > 0;

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
            <li key={kennung(p)}>
              <DynamicPhotoTile
                photo={p}
                index={i}
                formularId={formularId}
                onRemove={() => remove(p)}
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
          if (f) void addPhoto(f);
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
          if (f) void addPhoto(f);
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
            disabled={disabled}
          >
            {uploading ? `Hochladen … (${laufend})` : '+ Foto aufnehmen'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => galleryRef.current?.click()}
            disabled={disabled}
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
  const wartend = !photo.storage_path && !!photo.pending_id;

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    void (async () => {
      let u: string | null = null;
      if (photo.storage_path) {
        u = await getPhotoUrl(photo.storage_path, formularId);
        if (!u) {
          console.warn('[Bild-Vorschau] dynamic photo Laden fehlgeschlagen', {
            path: photo.storage_path, formularId,
          });
        }
      } else if (photo.pending_id) {
        // Wartet noch auf den Upload: Vorschau direkt aus der Warteschlange.
        const item = (await getUploadQueue().catch(() => [])).find((x) => x.id === photo.pending_id);
        if (item) u = URL.createObjectURL(item.blob);
      }
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      createdUrl = u;
      setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photo.storage_path, photo.pending_id, formularId]);

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
      {wartend && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-500/90 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
          wartet auf Upload
        </div>
      )}
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
