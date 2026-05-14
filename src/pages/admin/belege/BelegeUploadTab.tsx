import { useCallback, useMemo, useRef, useState } from 'react';
import { compressImage } from '../../../lib/photo';
import { heicToJpeg } from './heic';
import { ImageCropDialog } from './ImageCropDialog';
import { downloadBlob, generateBelegePdf, type Layout } from './belegPdf';

interface BelegItem {
  id: string;
  blob: Blob;
  url: string;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BelegeUploadTab() {
  const [items, setItems] = useState<BelegItem[]>([]);
  const [layout, setLayout] = useState<Layout>(12);
  const [filename, setFilename] = useState<string>(`Auslagen_${todayIso()}.pdf`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setBusy('Bilder werden verarbeitet …');
    try {
      const incoming = Array.from(files).filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
      const processed: BelegItem[] = [];
      for (const f of incoming) {
        try {
          const jpeg = await heicToJpeg(f);
          const compressed = await compressImage(jpeg);
          const url = URL.createObjectURL(compressed);
          processed.push({ id: makeId(), blob: compressed, url });
        } catch (e) {
          console.warn('Bild konnte nicht verarbeitet werden', f.name, e);
        }
      }
      if (processed.length === 0 && incoming.length > 0) {
        setError('Keine Bilder konnten verarbeitet werden.');
      }
      setItems((prev) => [...prev, ...processed]);
    } finally {
      setBusy(null);
    }
  }, []);

  function removeItem(id: string) {
    setItems((prev) => {
      const found = prev.find((i) => i.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((i) => i.id !== id);
    });
  }

  function move(id: string, delta: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [it] = next.splice(idx, 1);
      next.splice(target, 0, it);
      return next;
    });
  }

  // Drag-&-Drop-Reorder (Desktop, HTML5 Drag).
  const dragIdRef = useRef<string | null>(null);

  function applyCrop(id: string, blob: Blob) {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      URL.revokeObjectURL(i.url);
      return { ...i, blob, url: URL.createObjectURL(blob) };
    }));
    setEditingId(null);
  }

  async function handleGenerate() {
    if (items.length === 0) return;
    setBusy('PDF wird erstellt …');
    setError(null);
    try {
      const pdf = await generateBelegePdf({
        images: items.map((i) => i.blob),
        layout,
      });
      const cleanName = filename.trim().replace(/\.pdf$/i, '') || `Auslagen_${todayIso()}`;
      downloadBlob(pdf, `${cleanName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF-Erstellung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const editingItem = editingId ? items.find((i) => i.id === editingId) ?? null : null;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(items.length / layout)), [items.length, layout]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-maja-muted">Belege hochladen und als PDF zusammenstellen.</p>

      {/* Schritt 1: Upload + Liste */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          1. Bilder hochladen
        </h2>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer?.files) void addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? 'border-maja-accent bg-maja-light' : 'border-maja-navy/30 bg-white hover:bg-maja-light'
          }`}
        >
          <div className="text-maja-muted">
            <IconUpload />
          </div>
          <div className="mt-2 text-sm font-medium text-maja-navy">
            Bilder per Drag & Drop ablegen oder klicken zum Auswählen
          </div>
          <div className="text-xs text-maja-muted">JPG, PNG, HEIC — mehrere auf einmal möglich</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {items.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item, idx) => (
              <li
                key={item.id}
                draggable
                onDragStart={() => { dragIdRef.current = item.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragIdRef.current;
                  dragIdRef.current = null;
                  if (!src || src === item.id) return;
                  setItems((prev) => {
                    const srcIdx = prev.findIndex((p) => p.id === src);
                    const dstIdx = prev.findIndex((p) => p.id === item.id);
                    if (srcIdx < 0 || dstIdx < 0) return prev;
                    const next = prev.slice();
                    const [s] = next.splice(srcIdx, 1);
                    next.splice(dstIdx, 0, s);
                    return next;
                  });
                }}
                className="card relative overflow-hidden p-2"
              >
                <div className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-maja-navy text-xs font-semibold text-white shadow">
                  {idx + 1}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label="Bild entfernen"
                  className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-maja-ink shadow hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
                <img
                  src={item.url}
                  alt={`Beleg ${idx + 1}`}
                  className="aspect-[3/4] w-full rounded-md object-cover"
                  draggable={false}
                />
                <div className="mt-2 flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => move(item.id, -1)}
                      disabled={idx === 0}
                      aria-label="Nach vorn"
                      className="rounded-md px-2 py-1 text-xs font-medium text-maja-navy hover:bg-maja-light disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(item.id, 1)}
                      disabled={idx === items.length - 1}
                      aria-label="Nach hinten"
                      className="rounded-md px-2 py-1 text-xs font-medium text-maja-navy hover:bg-maja-light disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(item.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-maja-accent hover:bg-maja-light"
                  >
                    <IconCrop /> Zuschneiden
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Schritt 2: Layout */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          2. Layout
        </h2>
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <div className="flex gap-2">
            {([12, 16] as Layout[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setLayout(opt)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  layout === opt
                    ? 'border-maja-navy bg-maja-navy text-white'
                    : 'border-maja-navy/20 bg-white text-maja-navy hover:bg-maja-light'
                }`}
              >
                {opt} pro Seite ({opt === 12 ? '3×4' : '4×4'})
              </button>
            ))}
          </div>
          <div className="text-sm text-maja-muted">
            {items.length} {items.length === 1 ? 'Beleg' : 'Belege'} → {totalPages} {totalPages === 1 ? 'Seite' : 'Seiten'}
          </div>
        </div>

        {/* Mini-Vorschau der Seiten */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: totalPages }).map((_, p) => {
              const cols = layout === 12 ? 3 : 4;
              const rows = 4;
              const slice = items.slice(p * layout, (p + 1) * layout);
              return (
                <div key={p} className="card p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
                    Seite {p + 1}
                  </div>
                  <div
                    className="mt-1 grid gap-[2px] bg-maja-navy/10"
                    style={{
                      width: 140,
                      height: 198,
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: `repeat(${rows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: layout }).map((__, k) => {
                      const it = slice[k];
                      return (
                        <div key={k} className="flex items-center justify-center overflow-hidden bg-white">
                          {it && (
                            <img src={it.url} alt="" className="h-full w-full object-contain" draggable={false} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Schritt 3: PDF erstellen */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          3. PDF erstellen
        </h2>
        <div className="card space-y-3 p-4">
          <div>
            <label htmlFor="bel-name" className="label">Dateiname</label>
            <input
              id="bel-name"
              className="input"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={items.length === 0 || busy !== null}
            onClick={() => void handleGenerate()}
          >
            {busy ?? 'PDF erstellen'}
          </button>
        </div>
      </section>

      {editingItem && (
        <ImageCropDialog
          imageUrl={editingItem.url}
          onCancel={() => setEditingId(null)}
          onApply={(blob) => applyCrop(editingItem.id, blob)}
        />
      )}
    </div>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
      <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconCrop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M6 2v16h16M2 6h16v16" />
    </svg>
  );
}
