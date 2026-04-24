import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { pdfjsLib } from '../../lib/pdfjs';
import type { FieldMapping, FieldMappingEntry } from '../../types/db';

interface Props {
  /** ArrayBuffer der PDF (aus Storage oder lokalem Upload). */
  pdfBytes: ArrayBuffer;
  page: number;
  onPageCount: (n: number) => void;
  mapping: FieldMapping;
  /** Nur Marker dieser Feld-IDs zeichnen. Leer = alle. */
  highlightFields?: string[];
  /** Beim Klick aufs PDF: Feld-Picker öffnen */
  onClick: (coords: { x: number; y: number; page: number }) => void;
  /** Existierenden Marker anklicken */
  onMarkerClick?: (fieldId: string) => void;
  /** Welches Feld ist markierender Ziel (für Label-Bounding-Box bei Fotos) */
  selectedFieldId?: string | null;
}

const RENDER_SCALE = 1.5;

export function PdfMappingCanvas({
  pdfBytes, page, onPageCount, mapping,
  highlightFields, onClick, onMarkerClick, selectedFieldId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);

    async function render() {
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      if (cancelled) return;
      onPageCount(pdf.numPages);
      const pageNum = Math.max(1, Math.min(page, pdf.numPages));
      const p = await pdf.getPage(pageNum);
      if (cancelled) return;
      const viewport = p.getViewport({ scale: RENDER_SCALE });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;
      // PDF-Punkte (1:1-Scale) merken, damit wir Klicks später rückrechnen können.
      const basic = p.getViewport({ scale: 1 });
      setPageSize({ w: basic.width, h: basic.height });
      setRendering(false);
    }

    render().catch((err) => {
      console.error('PDF-Render-Fehler', err);
      setRendering(false);
    });

    return () => { cancelled = true; };
  }, [pdfBytes, page, onPageCount]);

  function toPdfCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas || !pageSize) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = pageSize.w / rect.width;
    const scaleY = pageSize.h / rect.height;
    const x = (clientX - rect.left) * scaleX;
    // PDF-Koordinaten haben Ursprung unten-links, Canvas oben-links → umdrehen.
    const y = pageSize.h - (clientY - rect.top) * scaleY;
    return { x, y };
  }

  function handleCanvasClick(e: MouseEvent<HTMLDivElement>) {
    const pdf = toPdfCoords(e.clientX, e.clientY);
    if (!pdf) return;
    onClick({ x: pdf.x, y: pdf.y, page });
  }

  const markers = Object.entries(mapping).filter(
    ([id, m]) =>
      m.page === page && (!highlightFields || highlightFields.includes(id)),
  );

  return (
    <div className="relative inline-block">
      {rendering && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-sm text-maja-muted">
          PDF wird gerendert …
        </div>
      )}
      <div
        className="relative cursor-crosshair shadow-card"
        onClick={handleCanvasClick}
      >
        <canvas ref={canvasRef} className="block max-w-full" />
        {pageSize && markers.map(([fieldId, m]) => (
          <MarkerOverlay
            key={fieldId}
            fieldId={fieldId}
            entry={m}
            pageSize={pageSize}
            selected={selectedFieldId === fieldId}
            onClick={(e) => {
              e.stopPropagation();
              onMarkerClick?.(fieldId);
            }}
          />
        ))}
      </div>
      {pageSize && (
        <p className="mt-2 text-xs text-maja-muted">
          Seitengröße: {Math.round(pageSize.w)} × {Math.round(pageSize.h)} pt.
          Klicke ins PDF, um ein Feld dort zu positionieren.
        </p>
      )}
    </div>
  );
}

function MarkerOverlay({
  fieldId, entry, pageSize, selected, onClick,
}: {
  fieldId: string;
  entry: FieldMappingEntry;
  pageSize: { w: number; h: number };
  selected: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  // Rechne PDF-Punkte → CSS-Prozent (Canvas wird via max-w-full skaliert).
  const leftPct = (entry.x / pageSize.w) * 100;
  // Canvas/CSS: top = (pageH - y) / pageH (Ursprung oben)
  const topPct = ((pageSize.h - entry.y) / pageSize.h) * 100;
  const widthPct = entry.width ? (entry.width / pageSize.w) * 100 : null;
  const heightPct = entry.height ? (entry.height / pageSize.h) * 100 : null;

  const style: React.CSSProperties = widthPct && heightPct
    ? {
        left: `${leftPct}%`, top: `${topPct}%`,
        width: `${widthPct}%`, height: `${heightPct}%`,
      }
    : { left: `${leftPct}%`, top: `${topPct}%` };

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'absolute z-20 origin-top-left overflow-visible whitespace-nowrap rounded ' +
        (widthPct && heightPct
          ? 'border-2 ' + (selected ? 'border-red-600 bg-red-500/10' : 'border-maja-accent bg-maja-accent/10')
          : 'px-1.5 py-0.5 text-[10px] font-semibold text-white ' +
            (selected ? 'bg-red-600' : 'bg-maja-accent'))
      }
      style={style}
      title={fieldId}
    >
      {!widthPct && !heightPct && fieldId}
    </button>
  );
}
