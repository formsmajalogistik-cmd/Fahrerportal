import { useRef } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { GripIcon, XIcon } from '../../../components/icons';
import { formatEuro } from '../../../lib/touren';
import {
  formatDecimal, parseDecimal, recomputeGesamt,
  type EditorPosition,
} from './positionUtils';

interface Props {
  positionen: EditorPosition[];
  readOnly?: boolean;
  /** Standard-USt-Satz der Rechnung — wird als Platzhalter angezeigt,
   *  wenn die Position keinen eigenen Satz hat. */
  defaultUstSatz?: number;
  onChange: (next: EditorPosition[]) => void;
}

/** Parst die "USt %"-Eingabe — leeres Feld setzt null (= Standard). */
function parseUst(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
function formatUst(v: number | null | undefined): string {
  if (v == null) return '';
  return formatDecimal(Number(v));
}

/**
 * Editierbare Positionstabelle für die Rechnungserstellung und das
 * Detail. Drag & Drop nutzt dnd-kit (Pointer + Touch + Keyboard) und
 * ein dediziertes Handle-Icon, damit die normalen Input-Felder
 * weiterhin ohne Drag-Auslöser editierbar sind. Die Position-Nummern
 * werden bei jedem onChange aus dem neuen Index neu vergeben.
 */
export function PositionsTable({ positionen, readOnly, defaultUstSatz, onChange }: Props) {
  // dnd-kit-Sensoren: PointerSensor (Maus + Stift), TouchSensor mit
  // 150 ms Long-Press / 5 px Tolerance (verhindert versehentliches
  // Drag beim Scrollen) und Keyboard für Tastaturbedienung.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function patch(key: string, p: Partial<EditorPosition>) {
    onChange(positionen.map((row) => {
      if (row.key !== key) return row;
      const merged = { ...row, ...p };
      // Bei Mengen-/Preis-Änderung Gesamtpreis live berechnen.
      if ('menge' in p || 'einzelpreis' in p) return recomputeGesamt(merged);
      return merged;
    }));
  }

  function remove(key: string) {
    onChange(positionen.filter((r) => r.key !== key));
  }

  function updateUnterzeile(key: string, idx: number, text: string) {
    const row = positionen.find((p) => p.key === key);
    if (!row) return;
    const lines = row.unterzeilen.slice();
    lines[idx] = text;
    patch(key, { unterzeilen: lines });
  }

  function addUnterzeile(key: string) {
    const row = positionen.find((p) => p.key === key);
    if (!row) return;
    patch(key, { unterzeilen: [...row.unterzeilen, ''] });
  }

  function removeUnterzeile(key: string, idx: number) {
    const row = positionen.find((p) => p.key === key);
    if (!row) return;
    patch(key, { unterzeilen: row.unterzeilen.filter((_, i) => i !== idx) });
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = e.active?.id;
    const overId   = e.over?.id;
    if (!activeId || !overId || activeId === overId) return;
    const srcIdx = positionen.findIndex((p) => p.key === activeId);
    const dstIdx = positionen.findIndex((p) => p.key === overId);
    if (srcIdx < 0 || dstIdx < 0) return;
    onChange(arrayMove(positionen, srcIdx, dstIdx));
  }

  if (positionen.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-maja-navy/20 p-6 text-center text-sm text-maja-muted">
        Noch keine Positionen vorhanden.
      </div>
    );
  }

  const rowCtx: RowCtx = {
    readOnly: !!readOnly,
    defaultUstSatz,
    patch,
    remove,
    updateUnterzeile,
    addUnterzeile,
    removeUnterzeile,
  };

  const tableBody = (
    <tbody className="divide-y divide-maja-navy/10">
      {positionen.map((p, idx) => (
        <SortableRow
          key={p.key}
          position={p}
          index={idx}
          ctx={rowCtx}
        />
      ))}
    </tbody>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-maja-navy/10">
      <table className="w-full text-sm">
        <thead className="bg-maja-light text-left text-maja-navy">
          <tr>
            {!readOnly && <th className="w-8 px-2 py-2" aria-label="Sortieren" />}
            <th className="w-10 px-3 py-2 text-center font-semibold">Pos.</th>
            <th className="px-3 py-2 font-semibold">Bezeichnung</th>
            <th className="w-24 px-3 py-2 text-right font-semibold">Menge</th>
            <th className="w-28 px-3 py-2 text-right font-semibold">Einzelpreis</th>
            <th className="w-28 px-3 py-2 text-right font-semibold">Gesamt</th>
            <th className="w-20 px-3 py-2 text-right font-semibold" title="USt-Satz dieser Position">USt %</th>
            {!readOnly && <th className="w-10 px-3 py-2"></th>}
          </tr>
        </thead>
        {readOnly ? tableBody : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={positionen.map((p) => p.key)}
              strategy={verticalListSortingStrategy}
            >
              {tableBody}
            </SortableContext>
          </DndContext>
        )}
      </table>
    </div>
  );
}

// ---- Row-Komponente -------------------------------------------------

interface RowCtx {
  readOnly: boolean;
  defaultUstSatz?: number;
  patch: (key: string, p: Partial<EditorPosition>) => void;
  remove: (key: string) => void;
  updateUnterzeile: (key: string, idx: number, text: string) => void;
  addUnterzeile: (key: string) => void;
  removeUnterzeile: (key: string, idx: number) => void;
}

function SortableRow({
  position: p, index, ctx,
}: { position: EditorPosition; index: number; ctx: RowCtx }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: p.key, disabled: ctx.readOnly });
  const cellRef = useRef<HTMLTableCellElement | null>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging
      ? '0 6px 16px rgba(15, 23, 42, 0.18)'
      : undefined,
    backgroundColor: isDragging ? '#ffffff' : undefined,
    position: 'relative',
  };
  return (
    <tr ref={setNodeRef} style={style}>
      {!ctx.readOnly && (
        <td ref={cellRef} className="px-2 py-2 align-middle">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Position verschieben"
            className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded text-maja-muted hover:bg-maja-light hover:text-maja-navy active:cursor-grabbing"
            title="Ziehen, um zu sortieren"
          >
            <GripIcon className="h-4 w-4" />
          </button>
        </td>
      )}
      <td className="px-3 py-2 text-center text-xs font-semibold text-maja-muted">
        {index + 1}
      </td>
      <td className="px-3 py-2">
        {ctx.readOnly ? (
          <div>
            <div className="font-medium text-maja-ink">{p.bezeichnung}</div>
            {p.unterzeilen.map((u, i) => (
              <div key={i} className="text-xs text-maja-muted">
                {u || ' '}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <input
              className="input w-full"
              value={p.bezeichnung}
              onChange={(e) => ctx.patch(p.key, { bezeichnung: e.target.value })}
              placeholder="Bezeichnung"
            />
            {p.unterzeilen.map((u, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  className="input flex-1 text-xs"
                  value={u}
                  onChange={(e) => ctx.updateUnterzeile(p.key, i, e.target.value)}
                  placeholder="Unterzeile (optional)"
                />
                <button
                  type="button"
                  aria-label="Unterzeile entfernen"
                  className="rounded p-1 text-red-600 hover:bg-red-50"
                  onClick={() => ctx.removeUnterzeile(p.key, i)}
                ><XIcon className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => ctx.addUnterzeile(p.key)}
              className="text-xs font-medium text-maja-accent hover:underline"
            >+ Unterzeile</button>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {ctx.readOnly ? (
          <span className="tabular-nums">{formatDecimal(p.menge)}</span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            className="input w-20 text-right tabular-nums"
            value={formatDecimal(p.menge)}
            onChange={(e) => ctx.patch(p.key, { menge: parseDecimal(e.target.value) })}
          />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {ctx.readOnly ? (
          <span className="tabular-nums">{formatEuro(p.einzelpreis)}</span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            className="input w-24 text-right tabular-nums"
            value={formatDecimal(p.einzelpreis)}
            onChange={(e) => ctx.patch(p.key, { einzelpreis: parseDecimal(e.target.value) })}
          />
        )}
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">
        {formatEuro(p.gesamtpreis)}
      </td>
      <td className="px-3 py-2 text-right">
        {ctx.readOnly ? (
          p.ust_satz != null ? (
            <span className="tabular-nums font-semibold text-maja-accent">
              {formatDecimal(Number(p.ust_satz))} %
            </span>
          ) : (
            <span className="tabular-nums text-maja-muted">
              {ctx.defaultUstSatz != null ? `${formatDecimal(ctx.defaultUstSatz)} %` : '—'}
            </span>
          )
        ) : (
          <input
            type="text"
            inputMode="decimal"
            className={`input w-16 text-right tabular-nums ${
              p.ust_satz != null ? 'border-maja-accent font-semibold text-maja-accent' : ''
            }`}
            value={formatUst(p.ust_satz)}
            placeholder={ctx.defaultUstSatz != null ? `${formatDecimal(ctx.defaultUstSatz)}` : '19'}
            onChange={(e) => ctx.patch(p.key, { ust_satz: parseUst(e.target.value) })}
            title="Leer = Standard-USt-Satz der Rechnung"
          />
        )}
      </td>
      {!ctx.readOnly && (
        <td className="px-2 py-2">
          <button
            type="button"
            aria-label="Position löschen"
            className="rounded p-1 text-red-600 hover:bg-red-50"
            onClick={() => ctx.remove(p.key)}
          ><XIcon className="h-4 w-4" /></button>
        </td>
      )}
    </tr>
  );
}
