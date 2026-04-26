import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { pdfjsLib } from '../../lib/pdfjs';
import {
  computeDynamicSlots,
  isBoxEntry, isDynamicEntry, isOptionsEntry, isTextEntry,
  OPTION_DEFAULT_SIZE,
} from '../../lib/fieldMapping';
import type { FieldMapping } from '../../types/db';

interface MarkerSelection {
  fieldId: string;
  optionName?: string;
}

interface Props {
  /** ArrayBuffer der PDF (aus Storage oder lokalem Upload). */
  pdfBytes: ArrayBuffer;
  page: number;
  onPageCount: (n: number) => void;
  mapping: FieldMapping;
  /** Welches Feld/welche Option ist gerade ausgewählt (rote Hervorhebung). */
  selected?: MarkerSelection | null;
  /** Klick auf leere Stelle → Position für neuen Marker. */
  onClick: (coords: { x: number; y: number; page: number }) => void;
  /** Klick auf existierenden Marker. */
  onMarkerClick?: (sel: MarkerSelection) => void;
  /** Optionale Label-Map für Marker-Tooltips (Feld-ID → Anzeigename). */
  fieldLabels?: Record<string, string>;
}

const RENDER_SCALE = 1.5;

export function PdfMappingCanvas({
  pdfBytes, page, onPageCount, mapping,
  selected, onClick, onMarkerClick, fieldLabels,
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
    // PDF-Ursprung ist unten-links, Canvas oben-links → Y umdrehen.
    const y = pageSize.h - (clientY - rect.top) * scaleY;
    return { x, y };
  }

  function handleCanvasClick(e: MouseEvent<HTMLDivElement>) {
    const pdf = toPdfCoords(e.clientX, e.clientY);
    if (!pdf) return;
    onClick({ x: pdf.x, y: pdf.y, page });
  }

  return (
    <div className="relative inline-block">
      {rendering && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-sm text-maja-muted">
          PDF wird gerendert …
        </div>
      )}
      <div className="relative cursor-crosshair shadow-card" onClick={handleCanvasClick}>
        <canvas ref={canvasRef} className="block max-w-full" />
        {pageSize && Object.entries(mapping).flatMap(([fieldId, entry]) => {
          const label = fieldLabels?.[fieldId] ?? fieldId;
          if (isTextEntry(entry)) {
            if (entry.page !== page) return [];
            const isSel = selected?.fieldId === fieldId && !selected?.optionName;
            return [
              <PointMarker
                key={fieldId}
                pageSize={pageSize}
                x={entry.x}
                y={entry.y}
                label={label}
                selected={isSel}
                onClick={(e) => { e.stopPropagation(); onMarkerClick?.({ fieldId }); }}
              />,
            ];
          }
          if (isBoxEntry(entry)) {
            if (entry.page !== page) return [];
            const isSel = selected?.fieldId === fieldId && !selected?.optionName;
            return [
              <BoxMarker
                key={fieldId}
                pageSize={pageSize}
                x={entry.x}
                y={entry.y}
                width={entry.width}
                height={entry.height}
                label={label}
                selected={isSel}
                onClick={(e) => { e.stopPropagation(); onMarkerClick?.({ fieldId }); }}
              />,
            ];
          }
          if (isOptionsEntry(entry)) {
            return Object.entries(entry.options)
              .filter(([, pos]) => pos.page === page)
              .map(([opt, pos]) => {
                const isSel =
                  selected?.fieldId === fieldId && selected?.optionName === opt;
                return (
                  <CheckMarker
                    key={`${fieldId}::${opt}`}
                    pageSize={pageSize}
                    x={pos.x}
                    y={pos.y}
                    size={pos.size ?? OPTION_DEFAULT_SIZE}
                    label={`${label} → ${opt}`}
                    selected={isSel}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkerClick?.({ fieldId, optionName: opt });
                    }}
                  />
                );
              });
          }
          if (isDynamicEntry(entry) && entry.page === page) {
            const isSel = selected?.fieldId === fieldId && !selected?.optionName;
            const slots = computeDynamicSlots(entry, entry.perPage);
            return slots
              .filter((s) => s.pageOffset === 0)
              .map((s, i) => (
                <BoxMarker
                  key={`${fieldId}::slot${i}`}
                  pageSize={pageSize}
                  x={s.x}
                  y={s.y}
                  width={s.width}
                  height={s.height}
                  label={`${label} #${i + 1}`}
                  selected={isSel}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkerClick?.({ fieldId });
                  }}
                />
              ));
          }
          return [];
        })}
      </div>
      {pageSize && (
        <p className="mt-2 text-xs text-maja-muted">
          Seitengröße: {Math.round(pageSize.w)} × {Math.round(pageSize.h)} pt.
          Klicke ins PDF, um eine Position zu setzen.
        </p>
      )}
    </div>
  );
}

// ---------- Marker-Komponenten ----------

function PointMarker({
  pageSize, x, y, label, selected, onClick,
}: {
  pageSize: { w: number; h: number };
  x: number; y: number;
  label: string; selected: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const left = (x / pageSize.w) * 100;
  const top = ((pageSize.h - y) / pageSize.h) * 100;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={
        'absolute z-20 -translate-y-full whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ' +
        (selected ? 'bg-red-600' : 'bg-maja-accent')
      }
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      {label}
    </button>
  );
}

function BoxMarker({
  pageSize, x, y, width, height, label, selected, onClick,
}: {
  pageSize: { w: number; h: number };
  x: number; y: number; width: number; height: number;
  label: string; selected: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const leftPct = (x / pageSize.w) * 100;
  // entry.y = oberer Rand der Box (in PDF-Koords)
  const topPct = ((pageSize.h - y) / pageSize.h) * 100;
  const widthPct = (width / pageSize.w) * 100;
  const heightPct = (height / pageSize.h) * 100;

  const style: CSSProperties = {
    left: `${leftPct}%`, top: `${topPct}%`,
    width: `${widthPct}%`, height: `${heightPct}%`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={
        'absolute z-20 origin-top-left rounded border-2 ' +
        (selected ? 'border-red-600 bg-red-500/10' : 'border-maja-accent bg-maja-accent/10')
      }
      style={style}
    >
      <span className={
        'absolute -top-5 left-0 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-semibold text-white ' +
        (selected ? 'bg-red-600' : 'bg-maja-accent')
      }>
        {label}
      </span>
    </button>
  );
}

function CheckMarker({
  pageSize, x, y, size, label, selected, onClick,
}: {
  pageSize: { w: number; h: number };
  x: number; y: number; size: number;
  label: string; selected: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  // Häkchen-Marker: ein Quadrat von `size` PDF-Punkten, Anker unten-links
  const leftPct = (x / pageSize.w) * 100;
  const topPct = ((pageSize.h - y - size) / pageSize.h) * 100;
  const sizePctW = (size / pageSize.w) * 100;
  const sizePctH = (size / pageSize.h) * 100;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={
        'absolute z-20 flex items-center justify-center rounded-sm text-[10px] font-bold ' +
        (selected
          ? 'border-2 border-red-600 bg-red-500 text-white'
          : 'border-2 border-maja-accent bg-white text-maja-accent')
      }
      style={{
        left: `${leftPct}%`, top: `${topPct}%`,
        width: `${sizePctW}%`, height: `${sizePctH}%`,
      }}
    >
      ✓
    </button>
  );
}
