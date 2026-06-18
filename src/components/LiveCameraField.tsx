import { useCallback, useEffect, useRef, useState } from 'react';

export interface CapturedImage {
  file: File;
  /** Aufnahmezeitpunkt (Frontend-Zeitstempel, ISO). */
  takenAt: string;
}

interface Props {
  label: string;
  value: CapturedImage | null;
  onChange: (v: CapturedImage | null) => void;
  disabled?: boolean;
}

/**
 * In-App-Live-Kamera (getUserMedia) — NUR für die Führerscheinkontrolle.
 *
 * Bewusst KEIN Datei-Input und KEINE Galerie-Option: es können nur live
 * aufgenommene Bilder verwendet werden. Bei fehlendem/abgelehntem
 * Kamerazugriff gibt es eine klare Fehlermeldung, aber KEINEN Fallback
 * auf die Galerie.
 *
 * HINWEIS: Eine 100%ige „Live"-Garantie ist im Browser technisch nicht
 * möglich (ein Screenshot vor die Kamera o.ä. lässt sich nicht
 * ausschließen). Die In-App-Kamera ist aber die robusteste Methode, da
 * kein Zugriff auf gespeicherte Bilder/Dateien besteht.
 */
export function LiveCameraField({ label, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [captured, setCaptured] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Vorschau des übernommenen Bildes.
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      queueMicrotask(() => { if (!cancelled) setPreviewUrl(null); });
      return () => { cancelled = true; };
    }
    const url = URL.createObjectURL(value.file);
    queueMicrotask(() => { if (!cancelled) setPreviewUrl(url); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [value]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('not-supported', 'NotSupportedError');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => { /* iOS verlangt ggf. Geste — Element ist sichtbar */ });
      }
    } catch (e) {
      setError(cameraErrorMessage(e));
    }
  }, []);

  // Stream-Lebenszyklus an das offene Modal koppeln. Deferred, damit kein
  // setState synchron im Effect-Body läuft.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setCaptured(null);
      void startStream();
    }, 0);
    return () => { window.clearTimeout(t); stopStream(); };
  }, [open, startStream, stopStream]);

  function doCapture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      // Kamera nach der Aufnahme freigeben.
      stopStream();
      setCaptured({ blob, url: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.85);
  }

  function retake() {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    void startStream();
  }

  function accept() {
    if (!captured) return;
    const file = new File([captured.blob], `${sanitize(label)}.jpg`, { type: 'image/jpeg' });
    onChange({ file, takenAt: new Date().toISOString() });
    URL.revokeObjectURL(captured.url);
    setCaptured(null);
    setOpen(false);
  }

  function cancel() {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    stopStream();
    setOpen(false);
  }

  return (
    <div className="rounded-lg border border-slate-300 p-2 dark:border-slate-600">
      <div className="mb-1 text-xs font-medium text-maja-ink">{label}</div>
      <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-md bg-maja-light dark:bg-surface-700">
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-xs text-maja-muted">noch nicht aufgenommen</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {value ? 'Neu aufnehmen' : 'Aufnehmen'}
        </button>
        {value && (
          <button
            type="button"
            className="px-1 text-xs font-medium text-red-600 hover:underline"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Entfernen
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-4">
          <div className="mb-2 text-center text-sm font-medium text-white">
            {label} — live aufnehmen
          </div>
          {error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-sm text-sm text-white">{error}</p>
              <button type="button" className="btn-secondary" onClick={() => void startStream()}>
                Erneut versuchen
              </button>
              <button type="button" className="text-sm text-white/80 underline" onClick={cancel}>
                Abbrechen
              </button>
            </div>
          ) : captured ? (
            <>
              <div className="flex flex-1 items-center justify-center overflow-hidden">
                <img src={captured.url} alt={label} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" className="btn-secondary" onClick={retake}>
                  Erneut aufnehmen
                </button>
                <button type="button" className="btn-primary" onClick={accept}>
                  Übernehmen
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-1 items-center justify-center overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" className="btn-secondary" onClick={cancel}>
                  Abbrechen
                </button>
                <button type="button" className="btn-primary" onClick={doCapture}>
                  Aufnehmen
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bild';
}

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Kamerazugriff verweigert. Für die Führerscheinkontrolle ist die '
      + 'Kamera erforderlich — bitte den Zugriff in den Browser-/App-'
      + 'Einstellungen erlauben und erneut versuchen.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Es wurde keine Kamera gefunden. Für die Führerscheinkontrolle ist '
      + 'eine Kamera erforderlich.';
  }
  return 'Kamera nicht verfügbar. Für die Führerscheinkontrolle ist '
    + 'Kamerazugriff erforderlich (nur über HTTPS bzw. die installierte App).';
}
