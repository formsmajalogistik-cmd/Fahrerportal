import { useEffect, useRef, useState } from 'react';
import { pdfjsLib } from '../lib/pdfjs';

interface Props {
  /** Blob-URL der PDF (z.B. via fetchAttachmentBlob + createObjectURL). */
  src: string;
  /** Sichtbare Pixel-Skalierung. 1.5 = 150 % der Standard-72-DPI-Größe. */
  scale?: number;
  /** Höhe des Containers; default ist eine vernünftige Inline-Höhe. */
  maxHeight?: string;
}

/**
 * Rendert eine PDF Seite-für-Seite als Canvas + transparente Text-
 * Layer-Overlays. Damit kann der Admin in der Side-by-Side-Ansicht
 * Adressen / Kennzeichen / FIN aus dem PDF markieren und kopieren
 * (Aufgabe 2) — der iframe-Pfad blockiert das in Safari/Firefox.
 *
 * Lade-Strategie: Worker läuft global via src/lib/pdfjs.ts. Wir
 * rendern alle Seiten beim Mount; bei sehr großen PDFs könnte man
 * lazy-loaden, aber typische E-Mail-Anhänge sind 1-3 Seiten.
 */
export function PdfTextLayerViewer({
  src, scale = 1.5, maxHeight = '500px',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let pdfDoc: { destroy?: () => void; numPages: number } | null = null;
    const pageRefs: Array<{
      page: { cleanup?: () => void } | null;
      canvas: HTMLCanvasElement;
      textLayerDiv: HTMLDivElement;
    }> = [];

    // Container leeren — bei src-Wechsel werden alte Seiten verworfen.
    while (container.firstChild) container.removeChild(container.firstChild);

    void (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const doc = await pdfjsLib.getDocument(src).promise;
        if (cancelled) { doc.destroy(); return; }
        pdfDoc = doc;
        for (let i = 1; i <= doc.numPages; i += 1) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          if (cancelled) { page.cleanup(); return; }
          const viewport = page.getViewport({ scale });

          // Wrapper hält Canvas + TextLayer in der GLEICHEN Position.
          const pageWrap = document.createElement('div');
          pageWrap.style.position = 'relative';
          pageWrap.style.width = `${Math.ceil(viewport.width)}px`;
          pageWrap.style.height = `${Math.ceil(viewport.height)}px`;
          pageWrap.style.margin = '0 auto 12px';
          pageWrap.style.background = '#fff';
          pageWrap.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';

          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.position = 'absolute';
          canvas.style.inset = '0';
          canvas.style.display = 'block';
          pageWrap.appendChild(canvas);

          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';
          textLayerDiv.style.position = 'absolute';
          textLayerDiv.style.inset = '0';
          // Native pdfjs-Text-Layer-Optik: Text ist transparent, Cursor
          // ist "text", Browser-Select greift wie auf normalem Text.
          pageWrap.appendChild(textLayerDiv);

          container.appendChild(pageWrap);

          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
          await page.render({ canvasContext: ctx, viewport }).promise;

          // Text-Layer: Inhalt + TextLayer-Helper.
          const textContent = await page.getTextContent();
          // pdfjs-dist v4 exportiert die TextLayer-Klasse aus dem
          // Hauptmodul; sie kümmert sich um Span-Erstellung +
          // Skalierung.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const TextLayerCtor = (pdfjsLib as any).TextLayer;
          if (TextLayerCtor) {
            const tl = new TextLayerCtor({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport,
            });
            await tl.render();
          } else {
            // Fallback für ältere pdfjs-Versionen — wenig elegant, aber
            // immer noch text-selektierbar.
            for (const item of textContent.items as Array<{ str: string }>) {
              const span = document.createElement('span');
              span.textContent = item.str;
              textLayerDiv.appendChild(span);
            }
          }
          pageRefs.push({ page, canvas, textLayerDiv });
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF konnte nicht geladen werden.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const p of pageRefs) p.page?.cleanup?.();
      pdfDoc?.destroy?.();
    };
  }, [src, scale]);

  return (
    <div
      style={{
        maxHeight,
        overflow: 'auto',
        background: '#f3f4f6',
        padding: '8px',
        borderRadius: '4px',
      }}
    >
      <PdfTextLayerStyles />
      {loading && (
        <p className="px-3 py-3 text-center text-xs text-maja-muted">PDF wird gerendert …</p>
      )}
      {error && (
        <p role="alert" className="px-3 py-3 text-center text-xs text-red-700">{error}</p>
      )}
      <div ref={containerRef} />
    </div>
  );
}

/**
 * Minimal-CSS für die pdf.js-Text-Layer-Selektion. Wir injekten es
 * inline statt das komplette pdf_viewer.css einzubinden — nur Span/
 * Selektion + transparenter Text werden gebraucht.
 */
function PdfTextLayerStyles() {
  return (
    <style>{`
      .textLayer {
        position: absolute;
        inset: 0;
        overflow: clip;
        opacity: 1;
        line-height: 1;
        text-align: initial;
      }
      .textLayer span,
      .textLayer br {
        color: transparent;
        position: absolute;
        white-space: pre;
        cursor: text;
        transform-origin: 0% 0%;
      }
      .textLayer ::selection {
        background: rgba(0, 100, 255, 0.35);
      }
    `}</style>
  );
}
