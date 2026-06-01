import { useRef } from 'react';
import { XIcon } from '../../../components/icons';
import { formatEuro } from '../../../lib/touren';
import {
  formatDecimal, parseDecimal, recomputeGesamt,
  type EditorPosition,
} from './positionUtils';

interface Props {
  positionen: EditorPosition[];
  readOnly?: boolean;
  onChange: (next: EditorPosition[]) => void;
}

/**
 * Editierbare Positionstabelle für die Rechnungserstellung und das
 * Detail. Drag & Drop sortiert mittels HTML5-API (kein externes
 * Plugin) — die Position-Nummern werden bei jedem onChange aus dem
 * Index neu vergeben.
 */
export function PositionsTable({ positionen, readOnly, onChange }: Props) {
  const dragKey = useRef<string | null>(null);

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

  function moveItem(srcKey: string, dstKey: string) {
    if (srcKey === dstKey) return;
    const srcIdx = positionen.findIndex((p) => p.key === srcKey);
    const dstIdx = positionen.findIndex((p) => p.key === dstKey);
    if (srcIdx < 0 || dstIdx < 0) return;
    const next = positionen.slice();
    const [item] = next.splice(srcIdx, 1);
    next.splice(dstIdx, 0, item);
    onChange(next);
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

  if (positionen.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-maja-navy/20 p-6 text-center text-sm text-maja-muted">
        Noch keine Positionen vorhanden.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-maja-navy/10">
      <table className="w-full text-sm">
        <thead className="bg-maja-light text-left text-maja-navy">
          <tr>
            <th className="w-10 px-3 py-2 text-center font-semibold">Pos.</th>
            <th className="px-3 py-2 font-semibold">Bezeichnung</th>
            <th className="w-24 px-3 py-2 text-right font-semibold">Menge</th>
            <th className="w-28 px-3 py-2 text-right font-semibold">Einzelpreis</th>
            <th className="w-28 px-3 py-2 text-right font-semibold">Gesamt</th>
            {!readOnly && <th className="w-10 px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-maja-navy/10">
          {positionen.map((p, idx) => (
            <tr
              key={p.key}
              draggable={!readOnly}
              onDragStart={() => { dragKey.current = p.key; }}
              onDragOver={(e) => { if (!readOnly && dragKey.current) e.preventDefault(); }}
              onDrop={(e) => {
                if (readOnly) return;
                e.preventDefault();
                if (dragKey.current) moveItem(dragKey.current, p.key);
                dragKey.current = null;
              }}
              onDragEnd={() => { dragKey.current = null; }}
              className={readOnly ? '' : 'cursor-move'}
            >
              <td className="px-3 py-2 text-center text-xs font-semibold text-maja-muted">
                {idx + 1}
              </td>
              <td className="px-3 py-2">
                {readOnly ? (
                  <div>
                    <div className="font-medium text-maja-ink">{p.bezeichnung}</div>
                    {p.unterzeilen.map((u, i) => (
                      <div key={i} className="text-xs text-maja-muted">
                        {u || ' '}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      className="input w-full"
                      value={p.bezeichnung}
                      onChange={(e) => patch(p.key, { bezeichnung: e.target.value })}
                      placeholder="Bezeichnung"
                    />
                    {p.unterzeilen.map((u, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          className="input flex-1 text-xs"
                          value={u}
                          onChange={(e) => updateUnterzeile(p.key, i, e.target.value)}
                          placeholder="Unterzeile (optional)"
                        />
                        <button
                          type="button"
                          aria-label="Unterzeile entfernen"
                          className="rounded p-1 text-red-600 hover:bg-red-50"
                          onClick={() => removeUnterzeile(p.key, i)}
                        ><XIcon className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addUnterzeile(p.key)}
                      className="text-xs font-medium text-maja-accent hover:underline"
                    >+ Unterzeile</button>
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {readOnly ? (
                  <span className="tabular-nums">{formatDecimal(p.menge)}</span>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input w-20 text-right tabular-nums"
                    value={formatDecimal(p.menge)}
                    onChange={(e) => patch(p.key, { menge: parseDecimal(e.target.value) })}
                  />
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {readOnly ? (
                  <span className="tabular-nums">{formatEuro(p.einzelpreis)}</span>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input w-24 text-right tabular-nums"
                    value={formatDecimal(p.einzelpreis)}
                    onChange={(e) => patch(p.key, { einzelpreis: parseDecimal(e.target.value) })}
                  />
                )}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatEuro(p.gesamtpreis)}
              </td>
              {!readOnly && (
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label="Position löschen"
                    className="rounded p-1 text-red-600 hover:bg-red-50"
                    onClick={() => remove(p.key)}
                  ><XIcon className="h-4 w-4" /></button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
