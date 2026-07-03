import { useEffect, useState } from 'react';
import { XIcon, DownloadIcon } from './icons';
import { PdfCanvasPages } from './PdfCanvasPages';

interface Props {
  /** Blob-URL (URL.createObjectURL) der zu zeigenden PDF. */
  blobUrl: string;
  /** Anzeigename in der Header-Zeile + für den Download. */
  filename: string;
  onClose: () => void;
}

/**
 * Mobile Browser (< 640px, iOS Safari wie Android Chrome) rendern PDFs
 * in iframes nicht zuverlässig inline — Chrome zeigt nur einen grauen
 * Platzhalter mit funktionslosem „Öffnen"-Button, iOS höchstens die
 * erste Seite.
 */
function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 639px)').matches;
}

/**
 * Vollbild-Modal mit PDF-Vorschau. Desktop/Tablet: eingebettetes iframe
 * mit Blob-URL (bewährt, unverändert). Mobile: pdf.js-Canvas-Rendering
 * (PdfCanvasPages), Seiten scrollbar untereinander — unabhängig vom
 * nativen PDF-Support des Browsers. Zusätzlich „Öffnen in …" via
 * Web-Share-API (sofern verfügbar) und Download über data-URL
 * (Safari-PWA-tauglich).
 *
 * Der Caller ist für das URL.revokeObjectURL der Blob-URL verantwortlich
 * (z.B. nach onClose), damit der Speicher nicht hängenbleibt.
 */
export function PdfBlobPreviewModal({ blobUrl, filename, onClose }: Props) {
  // Einmal beim Öffnen entscheiden — Rotation/Resize mitten in der
  // Vorschau soll den Modus nicht umschalten.
  const [usePdfJs] = useState(isMobileViewport);
  const canShareFiles = typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function';

  // ESC schließt; sehr nützlich auf macOS-PWA.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Nativer „Öffnen in …"-Dialog über die Web-Share-API — auf iOS und
   * Android der zuverlässigste Weg, die PDF in eine andere App (Dateien,
   * Drive, Mail …) zu geben. Fallback: data-URL-Download.
   */
  async function shareOrDownload() {
    try {
      const blob = await fetch(blobUrl).then((r) => r.blob());
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (err) {
      // AbortError = Nutzer hat den Share-Dialog zugemacht — kein Fallback.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.warn('[PdfBlobPreviewModal] Web-Share fehlgeschlagen', err);
    }
    downloadViaDataUrl();
  }

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
      <header className="flex items-center justify-between gap-2 bg-maja-navy px-4 py-2 text-white">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {filename}
        </div>
        {canShareFiles && (
          <button
            type="button"
            onClick={() => void shareOrDownload()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
          >
            Öffnen in …
          </button>
        )}
        <button
          type="button"
          onClick={downloadViaDataUrl}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
        >
          <DownloadIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Herunterladen</span>
        </button>
        <button
          type="button"
          aria-label="Schließen"
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </header>
      {usePdfJs ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PdfCanvasPages blobUrl={blobUrl} />
        </div>
      ) : (
        <iframe
          title={filename}
          src={blobUrl}
          className="block h-full w-full flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}
