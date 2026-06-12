import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compressImage } from '../../../lib/photo';
import { pdfjsLib } from '../../../lib/pdfjs';
import {
  addBelege, clearBelege, DEFAULT_KENNZEICHEN_POSITION, listBelege,
  removeBeleg, reorderBelege, updateBelegBlob, updateBelegKennzeichen,
} from '../../../lib/belegeStorage';import { uploadToOneDrive } from '../../../lib/onedrive';
import { supabase } from '../../../lib/supabase';
import { heicToJpeg } from './heic';
import { ImageCropDialog } from './ImageCropDialog';
import { RechnungAssignDialog } from './RechnungAssignDialog';
import { downloadBlob, generateBelegePdf, type Layout } from './belegPdf';

interface BelegItem {
  id: string;
  blob: Blob;
  url: string;
  /** Optionaler Kennzeichen-Text als Overlay auf diesem Beleg. */
  kennzeichen: string;
}

// Render-Auflösung für aus PDFs extrahierte Seiten. PDFs sind
// standardmäßig 72 DPI; 150 ist ein guter Kompromiss zwischen
// Qualität und Datei-/Speichergröße auf mobilen Geräten.
const PDF_RENDER_DPI = 150;

/**
 * Rendert jede Seite einer PDF als JPEG-Bild im Browser. Nutzt das
 * bereits global konfigurierte pdfjs-dist (siehe src/lib/pdfjs.ts).
 * onProgress wird vor dem Rendern jeder Seite aufgerufen, damit der
 * Aufrufer einen "Seite x von y"-Hinweis anzeigen kann.
 */
async function pdfToJpegPages(
  file: File,
  onProgress?: (current: number, total: number) => void,
): Promise<File[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  const out: File[] = [];
  const baseName = file.name.replace(/\.pdf$/i, '') || 'pdf';
  const scale = PDF_RENDER_DPI / 72;
  for (let i = 1; i <= total; i += 1) {
    onProgress?.(i, total);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      page.cleanup();
      throw new Error('Canvas-Kontext nicht verfügbar');
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    page.cleanup();
    if (!blob) throw new Error(`Seite ${i} konnte nicht gerendert werden`);
    out.push(new File([blob], `${baseName} - Seite ${i}.jpg`, { type: 'image/jpeg' }));
  }
  return out;
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
  /** Unterscheidet, welche Aktion gerade läuft — sonst zeigt der
   *  Download-Button den Assign-Hinweis und umgekehrt. */
  const [busyAction, setBusyAction] = useState<'download' | 'assign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignToast, setAssignToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function setItemKennzeichen(id: string, kennzeichen: string) {
    setItems((prev) => prev.map((i) =>
      i.id === id ? { ...i, kennzeichen } : i,
    ));
    void updateBelegKennzeichen(
      id,
      kennzeichen.trim() || null,
      DEFAULT_KENNZEICHEN_POSITION,
    );
  }

  // Beim Mount aus IndexedDB laden — Belege überleben Reiter-Wechsel
  // und Tab-Refresh. Async-Wrapper, damit setState nicht synchron im
  // Effect-Body landet (React-19-Linter).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      try {
        const stored = await listBelege();
        if (cancelled) return;
        const restored: BelegItem[] = stored.map((r) => ({
          id: r.id,
          blob: r.blob,
          url: URL.createObjectURL(r.blob),
          kennzeichen: r.kennzeichen ?? '',
        }));
        setItems(restored);
      } catch (err) {
        console.warn('[BelegeUploadTab] listBelege fehlgeschlagen', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setInfo(null);
    const all = Array.from(files);
    const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isImage = (f: File) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name);
    const pdfs   = all.filter(isPdf);
    const images = all.filter((f) => !isPdf(f) && isImage(f));

    const processed: BelegItem[] = [];
    let extractedPages = 0;
    try {
      // 1) PDF-Dateien zuerst in Bilder zerlegen — pro Seite ein File.
      for (const pdf of pdfs) {
        setBusy(`PDF wird verarbeitet: ${pdf.name} …`);
        try {
          const pageFiles = await pdfToJpegPages(pdf, (current, total) => {
            setBusy(`PDF wird verarbeitet: ${pdf.name} — Seite ${current} von ${total}`);
          });
          extractedPages += pageFiles.length;
          for (const pageFile of pageFiles) {
            try {
              const compressed = await compressImage(pageFile);
              processed.push({
                id: makeId(),
                blob: compressed,
                url: URL.createObjectURL(compressed),
                kennzeichen: '',
              });
            } catch (e) {
              console.warn('PDF-Seite konnte nicht verarbeitet werden', pageFile.name, e);
            }
          }
        } catch (e) {
          console.warn('PDF konnte nicht geöffnet werden', pdf.name, e);
          setError(`PDF "${pdf.name}" konnte nicht geöffnet werden.`);
        }
      }

      // 2) Bilder (JPG/PNG/HEIC) wie bisher.
      if (images.length > 0) setBusy('Bilder werden verarbeitet …');
      for (const f of images) {
        try {
          const jpeg = await heicToJpeg(f);
          const compressed = await compressImage(jpeg);
          processed.push({
            id: makeId(),
            blob: compressed,
            url: URL.createObjectURL(compressed),
            kennzeichen: '',
          });
        } catch (e) {
          console.warn('Bild konnte nicht verarbeitet werden', f.name, e);
        }
      }

      if (processed.length === 0 && (images.length > 0 || pdfs.length > 0)) {
        setError('Keine Belege konnten verarbeitet werden.');
      } else if (extractedPages > 0) {
        setInfo(`${extractedPages} ${extractedPages === 1 ? 'Seite' : 'Seiten'} aus PDF extrahiert.`);
      }
      // Mit den IDs aus der DB überschreiben — `processed` enthält noch
      // die temporären `makeId`-Schlüssel, die für die Object-URL
      // gepasst haben; die persistente position-Spalte vergibt die
      // belegeStorage. So zeigt die UI sofort den finalen Stand.
      if (processed.length > 0) {
        const persisted = await addBelege(processed.map((p) => ({
          blob: p.blob,
          source: 'manuell',
          name: null,
        })));
        const synced: BelegItem[] = persisted.map((r, i) => ({
          id: r.id,
          blob: r.blob,
          // URL aus dem already-loaded processed-Eintrag wiederverwenden,
          // damit kein zusätzlicher createObjectURL-Roundtrip nötig ist.
          url: processed[i].url,
          kennzeichen: '',
        }));
        setItems((prev) => [...prev, ...synced]);
      }
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
    void removeBeleg(id);
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
      void reorderBelege(next.map((n) => n.id));
      return next;
    });
  }

  async function handleReset() {
    setConfirmReset(false);
    setItems((prev) => {
      for (const it of prev) URL.revokeObjectURL(it.url);
      return [];
    });
    try { await clearBelege(); }
    catch (err) { console.warn('[BelegeUploadTab] clearBelege', err); }
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
    void updateBelegBlob(id, blob);
    // Bildausschnitt hat sich geändert — Kennzeichen-Overlay-Position
    // zurück auf den Default (oben links). Der Text bleibt erhalten.
    setItems((prev) => {
      const cur = prev.find((i) => i.id === id);
      if (cur && cur.kennzeichen.trim()) {
        void updateBelegKennzeichen(id, cur.kennzeichen.trim(), DEFAULT_KENNZEICHEN_POSITION);
      }
      return prev;
    });
  }

  async function handleGenerate() {
    if (items.length === 0) return;
    setBusyAction('download');
    setBusy('PDF wird erstellt …');
    setError(null);
    try {
      const pdf = await generateBelegePdf({
        images: items.map((i) => ({
          blob: i.blob,
          kennzeichen: i.kennzeichen.trim() || null,
        })),
        layout,
      });
      const cleanName = filename.trim().replace(/\.pdf$/i, '') || `Auslagen_${todayIso()}`;
      downloadBlob(pdf, `${cleanName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF-Erstellung fehlgeschlagen');
    } finally {
      setBusy(null);
      setBusyAction(null);
    }
  }

  /**
   * "PDF erstellen & Rechnung zuordnen": generiert die Beleg-PDF, lädt
   * sie nach OneDrive und schreibt den Pfad als belege_pdf_url auf
   * die gewählte Rechnung. Belege bleiben im Zwischenspeicher
   * stehen, damit der Admin sie weiter bearbeiten kann.
   */
  async function handleAssignToRechnung(rechnung: { id: string; rechnungsnummer: string }) {
    if (items.length === 0) return;
    setAssignOpen(false);
    setBusyAction('assign');
    setBusy(`PDF wird erstellt … (Rechnung ${rechnung.rechnungsnummer})`);
    setError(null);
    try {
      const pdf = await generateBelegePdf({
        images: items.map((i) => ({
          blob: i.blob,
          kennzeichen: i.kennzeichen.trim() || null,
        })),
        layout,
      });
      const onedrivePath = `Maja-Logistik/Belege/${rechnung.rechnungsnummer}_${todayIso()}.pdf`;
      await uploadToOneDrive(onedrivePath, pdf);
      const { error: err } = await supabase
        .from('rechnungen')
        .update({ belege_pdf_url: onedrivePath })
        .eq('id', rechnung.id);
      if (err) throw new Error(err.message);
      setAssignToast(`Belege-PDF erstellt und Rechnung ${rechnung.rechnungsnummer} zugeordnet.`);
      window.setTimeout(() => setAssignToast(null), 4500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zuordnung fehlgeschlagen');
    } finally {
      setBusy(null);
      setBusyAction(null);
    }
  }

  const editingItem = editingId ? items.find((i) => i.id === editingId) ?? null : null;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(items.length / layout)), [items.length, layout]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-maja-muted">
          Belege hochladen und als PDF zusammenstellen. Hochgeladene
          Belege bleiben beim Reiter-Wechsel erhalten, bis sie über
          „Belege zurücksetzen" entfernt werden.
        </p>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Belege zurücksetzen ({items.length})
          </button>
        )}
      </div>

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
            Belege per Drag & Drop ablegen oder klicken zum Auswählen
          </div>
          <div className="text-xs text-maja-muted">
            JPG, PNG, HEIC oder PDF — mehrere auf einmal möglich. PDF-Seiten werden
            einzeln eingelesen.
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif,application/pdf,.pdf"
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
        {info && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {info}
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
                    void reorderBelege(next.map((n) => n.id));
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
                <div className="relative">
                  <img
                    src={item.url}
                    alt={`Beleg ${idx + 1}`}
                    className="aspect-[3/4] w-full rounded-md object-cover"
                    draggable={false}
                  />
                  {item.kennzeichen.trim() && editingId !== item.id && (
                    <KennzeichenOverlayLabel text={item.kennzeichen} />
                  )}
                </div>
                <input
                  type="text"
                  className="input mt-2 text-xs"
                  placeholder="Kennzeichen"
                  value={item.kennzeichen}
                  onChange={(e) => setItemKennzeichen(item.id, e.target.value)}
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={items.length === 0 || busy !== null}
              onClick={() => void handleGenerate()}
            >
              {busyAction === 'download' ? (busy ?? 'PDF wird erstellt …') : 'PDF herunterladen'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={items.length === 0 || busy !== null}
              onClick={() => setAssignOpen(true)}
              title="Erstellt die PDF, lädt sie in OneDrive hoch und verknüpft sie mit der gewählten Rechnung."
            >
              {busyAction === 'assign' ? (busy ?? 'PDF wird erstellt …') : 'PDF erstellen & Rechnung zuordnen'}
            </button>
          </div>
        </div>
      </section>

      {editingItem && (
        <ImageCropDialog
          imageUrl={editingItem.url}
          onCancel={() => setEditingId(null)}
          onApply={(blob) => applyCrop(editingItem.id, blob)}
        />
      )}
      {assignOpen && (
        <RechnungAssignDialog
          onClose={() => setAssignOpen(false)}
          onPick={(r) => void handleAssignToRechnung(r)}
        />
      )}
      {assignToast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {assignToast}
        </div>
      )}
      {confirmReset && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
          <div className="card w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-maja-navy">Alle hochgeladenen Belege entfernen?</h3>
            <p className="mt-2 text-sm text-maja-muted">
              Alle {items.length} Belege werden aus dem Zwischenspeicher
              gelöscht. Bereits erstellte PDFs sind davon nicht betroffen.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary"
                      onClick={() => setConfirmReset(false)}>
                Abbrechen
              </button>
              <button type="button"
                      className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                      onClick={() => void handleReset()}>
                Belege löschen
              </button>
            </div>
          </div>
        </div>
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

/**
 * Kennzeichen-Text als Overlay-Vorschau über einem Beleg-Bild — feste
 * Position oben links. Kein Drag, keine Pointer-Handler. Die finale
 * PDF rendert denselben Text an derselben relativen Position.
 */
function KennzeichenOverlayLabel({ text }: { text: string }) {
  return (
    <div
      className="pointer-events-none absolute left-1 top-1 select-none rounded bg-white/75 px-1.5 py-0.5 text-xs font-semibold text-black shadow-sm"
    >
      {text}
    </div>
  );
}
