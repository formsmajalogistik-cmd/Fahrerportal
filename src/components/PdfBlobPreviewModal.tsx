import { useEffect } from 'react';
import { XIcon, DownloadIcon } from './icons';

interface Props {
  /** Blob-URL (URL.createObjectURL) der zu zeigenden PDF. */
  blobUrl: string;
  /** Anzeigename in der Header-Zeile + für den Download. */
  filename: string;
  onClose: () => void;
}

/**
 * Vollbild-Modal mit eingebetteter PDF (iframe + Blob-URL). Wird als
 * Fallback für Safari/iOS-PWA genutzt, wo `window.open()` aus einem
 * Klick-Handler nach `await fetch(...)` blockt — und damit weder
 * Vorschau noch Download-Tab funktionieren.
 *
 * Der Caller ist für das URL.revokeObjectURL der Blob-URL verantwortlich
 * (z.B. nach onClose), damit der Speicher nicht hängenbleibt.
 */
export function PdfBlobPreviewModal({ blobUrl, filename, onClose }: Props) {
  // ESC schließt; sehr nützlich auf macOS-PWA.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function downloadViaDataUrl() {
    // FileReader → data-URL: in Safari PWA der zuverlässigste Weg,
    // einen Download zu triggern. Object-URLs verweigert Safari im
    // Standalone-Modus mitunter beim Anchor-Click.
    fetch(blobUrl)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader-Fehler'));
        reader.readAsDataURL(blob);
      }))
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      })
      .catch((err) => {
        console.warn('[PdfBlobPreviewModal] Download über data-URL fehlgeschlagen', err);
      });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-maja-ink/80">
      <header className="flex items-center justify-between gap-3 bg-maja-navy px-4 py-2 text-white">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {filename}
        </div>
        <button
          type="button"
          onClick={downloadViaDataUrl}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
        >
          <DownloadIcon className="h-4 w-4" />
          Herunterladen
        </button>
        <button
          type="button"
          aria-label="Schließen"
          onClick={onClose}
          className="rounded-md p-1.5 hover:bg-white/10"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </header>
      <iframe
        title={filename}
        src={blobUrl}
        className="block h-full w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
