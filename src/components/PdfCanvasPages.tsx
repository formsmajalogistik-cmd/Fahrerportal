import { useEffect, useRef, useState } from 'react';
import { pdfjsLib } from '../lib/pdfjs';

/**
 * Rendert eine PDF (Blob-URL) mit pdf.js Seite für Seite als Canvas —
 * Seiten untereinander, volle Containerbreite. Für Mobile gedacht, wo
 * iframe/embed-PDFs unzuverlässig sind (Android Chrome zeigt nur einen
 * Platzhalter, iOS Safari höchstens Seite 1). Der Eltern-Container ist
 * für das Scrollen zuständig.
 */
export function PdfCanvasPages({ blobUrl }: { blobUrl: string }) {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const pagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    void (async () => {
      try {
        // Reset bei blobUrl-Wechsel — async (Mikrotask), damit kein
        // synchrones setState im Effect-Body läuft (React-Linter).
        setState('loading');
        const buf = await fetch(blobUrl).then((r) => r.arrayBuffer());
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        destroy = () => { void pdf.destroy().catch(() => { /* ignore */ }); };
        if (cancelled) return;
        const container = pagesRef.current;
        if (!container) return;
        container.innerHTML = '';
        // CSS-Breite = Containerbreite; gerendert in DPR-Auflösung
        // (cap 2 — sonst frisst eine lange PDF auf Retina zu viel RAM).
        const cssWidth = Math.max(280, container.clientWidth);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= pdf.numPages; i += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (cssWidth / base.width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'mb-3 rounded bg-white shadow';
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
          await page.render({ canvasContext: ctx, viewport }).promise;
          page.cleanup();
          if (cancelled) return;
          container.appendChild(canvas);
        }
        setState('done');
      } catch (err) {
        console.warn('[PdfCanvasPages] pdf.js-Rendering fehlgeschlagen', err);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [blobUrl]);

  return (
    <div>
      {state === 'loading' && (
        <div className="py-10 text-center text-sm text-maja-muted">
          PDF wird geladen …
        </div>
      )}
      {state === 'error' && (
        <div className="mx-auto max-w-sm rounded-lg bg-white p-4 text-center text-sm text-maja-ink">
          Die PDF konnte nicht angezeigt werden. Bitte herunterladen und in
          einer anderen App öffnen.
        </div>
      )}
      <div ref={pagesRef} />
    </div>
  );
}
