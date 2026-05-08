import { useEffect, useMemo, useState } from 'react';
import { fillPdf } from '../../lib/pdfGenerate';
import { fetchPdfBytes } from '../../lib/pdfStorage';
import type { FormularTemplate, TemplatePdf } from '../../types/db';

interface Props {
  template: FormularTemplate;
  data: Record<string, unknown>;
  onClose: () => void;
}

interface RenderedPdf {
  pdf: TemplatePdf;
  url: string;
}

/**
 * Modaler PDF-Vorschau-Viewer. Generiert für jede PDF-Vorlage des Templates
 * eine gefüllte PDF auf Basis der aktuell eingegebenen Formulardaten und
 * zeigt sie im IFrame an. Es findet KEIN Upload nach OneDrive statt.
 */
export function PdfPreviewModal({ template, data, onClose }: Props) {
  const candidates = useMemo(
    () => (template.pdfs ?? []).filter((p) => !!p.path),
    [template],
  );
  const [rendered, setRendered] = useState<RenderedPdf[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const out: RenderedPdf[] = [];
        for (const p of candidates) {
          if (!p.path) continue;
          const tpl = await fetchPdfBytes(p.path);
          if (!tpl) continue;
          const filled = await fillPdf(
            tpl, template.schema, p.field_mapping ?? {}, data,
          );
          // pdf-lib gibt Uint8Array zurück; in einen frischen ArrayBuffer
          // kopieren, weil typeof TS unter strikten Modi sonst meckert.
          const buf = new ArrayBuffer(filled.byteLength);
          new Uint8Array(buf).set(filled);
          const blob = new Blob([buf], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          created.push(url);
          out.push({ pdf: p, url });
          if (cancelled) break;
        }
        if (!cancelled) {
          setRendered(out);
          setActiveIdx(0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF-Vorschau fehlgeschlagen');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      // Object-URLs wieder freigeben.
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [candidates, template.schema, data]);

  const active = rendered[activeIdx];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-maja-navy/10 bg-white px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-maja-navy">PDF-Vorschau</h2>
          <p className="text-xs text-maja-muted">
            Diese Vorschau wurde aus den aktuell eingegebenen Daten generiert. Das
            Formular wurde noch <strong>nicht</strong> eingereicht.
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Schließen
        </button>
      </header>

      {rendered.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-maja-navy/10 bg-white px-4 py-2">
          {rendered.map((r, i) => (
            <button
              key={r.pdf.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={
                'inline-block rounded-lg px-3 py-1.5 text-sm font-medium transition ' +
                (i === activeIdx
                  ? 'bg-maja-navy text-white'
                  : 'bg-maja-light text-maja-navy hover:bg-maja-light/70')
              }
            >
              {r.pdf.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden bg-maja-light/40">
        {busy ? (
          <div className="flex h-full items-center justify-center text-sm text-maja-muted">
            PDF wird generiert …
          </div>
        ) : error ? (
          <div role="alert" className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : rendered.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-maja-muted">
            Für dieses Template ist noch keine PDF-Vorlage hinterlegt — die
            Vorschau kann erst angezeigt werden, sobald eine Vorlage hochgeladen
            wurde.
          </div>
        ) : active ? (
          <iframe
            key={active.url}
            src={active.url}
            title={active.pdf.name}
            className="h-full w-full border-0"
          />
        ) : null}
      </div>
    </div>
  );
}
