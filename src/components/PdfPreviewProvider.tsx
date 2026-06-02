import { useEffect, useState } from 'react';
import { PdfBlobPreviewModal } from './PdfBlobPreviewModal';

/**
 * Globaler Listener für PDF-Vorschauen in Browsern, in denen
 * `window.open()` blockiert wird (Safari/iOS-PWA). Der Onedrive-
 * Helper `previewOneDrivePdf` dispatcht ein CustomEvent vom Typ
 * `maja:pdf-preview` mit `{ blobUrl, filename }` — dieser Provider
 * fängt das ab und rendert das Vollbild-PdfBlobPreviewModal.
 *
 * Wird einmalig im AppShell/AdminShell montiert.
 */
interface Detail { blobUrl: string; filename: string }

export function PdfPreviewProvider() {
  const [open, setOpen] = useState<Detail | null>(null);

  useEffect(() => {
    function onEvent(e: Event) {
      const ce = e as CustomEvent<Detail>;
      if (!ce.detail?.blobUrl) return;
      // Vorherige Vorschau aufräumen, falls noch eine offen war.
      setOpen((prev) => {
        if (prev?.blobUrl && prev.blobUrl !== ce.detail.blobUrl) {
          try { URL.revokeObjectURL(prev.blobUrl); } catch { /* ignore */ }
        }
        return ce.detail;
      });
    }
    window.addEventListener('maja:pdf-preview', onEvent as EventListener);
    return () => window.removeEventListener('maja:pdf-preview', onEvent as EventListener);
  }, []);

  if (!open) return null;
  return (
    <PdfBlobPreviewModal
      blobUrl={open.blobUrl}
      filename={open.filename}
      onClose={() => {
        try { URL.revokeObjectURL(open.blobUrl); } catch { /* ignore */ }
        setOpen(null);
      }}
    />
  );
}
