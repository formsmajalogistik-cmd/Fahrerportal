import { useCallback, useEffect, useRef, useState } from 'react';
import { DownloadIcon, EyeIcon, XIcon } from './icons';
import { useAuth } from '../auth/AuthContext';
import {
  deleteTourDokument, downloadTourDokument, istPdf, listTourDokumente,
  previewTourDokument, uploadTourDokument, type TourDokument,
} from '../lib/tourDokumente';

const ERLAUBTE_TYPEN = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/**
 * Extern erstellte Protokolle/Dokumente einer Tour (Migration 076).
 * Upload und Löschen nur für Admins (`canEdit`); Auftraggeber und der
 * Fahrer der Tour sehen die Liste read-only. Die Berechtigung wird
 * zusätzlich serverseitig per RLS geprüft — die UI ist nur die Hülle.
 */
export function TourDokumenteSection({
  tourId, canEdit, userId,
}: { tourId: string; canEdit: boolean; userId?: string | null }) {
  const { profile } = useAuth();
  const uploaderId = userId ?? profile?.id ?? null;
  const [docs, setDocs] = useState<TourDokument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bezeichnung, setBezeichnung] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    // setState asynchron (nach dem await), damit kein synchrones
    // setState im Effect-Body landet (react-hooks/set-state-in-effect).
    const list = await listTourDokumente(tourId);
    setDocs(list);
    setLoading(false);
  }, [tourId]);

  useEffect(() => {
    // Deferred starten (Pattern wie in den übrigen Widgets), damit kein
    // synchrones setState im Effect-Body steht.
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function handleFiles(files: FileList) {
    setError(null);
    setBusy('upload');
    try {
      // Mehrere Uploads pro Tour sind erlaubt — der Reihe nach, damit
      // die Fehlermeldung eindeutig einer Datei zuzuordnen ist.
      for (const file of Array.from(files)) {
        await uploadTourDokument({
          tourId, file,
          bezeichnung: Array.from(files).length === 1 ? bezeichnung : null,
          userId: uploaderId,
        });
      }
      setBezeichnung('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(dok: TourDokument) {
    if (!confirm(`„${dok.bezeichnung || dok.dateiname}" wirklich löschen?`)) return;
    setBusy(dok.id);
    setError(null);
    try {
      await deleteTourDokument(dok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="text-xs text-maja-muted">Dokumente werden geladen …</div>;
  // Ohne Dokumente und ohne Upload-Recht (Fahrer/Auftraggeber) gar nichts anzeigen.
  if (!canEdit && docs.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
        Externe Protokolle / Dokumente
      </div>

      {docs.length === 0 ? (
        <p className="text-xs text-maja-muted">Noch keine Dokumente hochgeladen.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy dark:border-slate-600 dark:bg-surface-700"
            >
              {istPdf(d) && (
                <button
                  type="button"
                  className="flex items-center px-2 py-1 hover:bg-maja-accent/20"
                  title={`Vorschau: ${d.dateiname}`}
                  aria-label="Vorschau"
                  disabled={busy !== null}
                  onClick={() => void previewTourDokument(d)}
                >
                  <EyeIcon className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-1 border-l border-slate-300 px-2 py-1 hover:bg-maja-accent/20 dark:border-slate-600"
                title={`Download: ${d.dateiname}`}
                disabled={busy !== null}
                onClick={() => void downloadTourDokument(d)}
              >
                <DownloadIcon className="h-4 w-4" />
                {d.bezeichnung || d.dateiname}
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="flex items-center border-l border-slate-300 px-1.5 py-1 text-red-600 hover:bg-red-50 dark:border-slate-600"
                  title="Dokument löschen"
                  aria-label="Löschen"
                  disabled={busy !== null}
                  onClick={() => void handleDelete(d)}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={`tdok-bez-${tourId}`} className="label">
              Bezeichnung (optional)
            </label>
            <input
              id={`tdok-bez-${tourId}`}
              className="input"
              value={bezeichnung}
              onChange={(e) => setBezeichnung(e.target.value)}
              placeholder="z.B. Übergabeprotokoll Kunde"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ERLAUBTE_TYPEN}
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) void handleFiles(e.target.files); }}
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy === 'upload' ? 'Lädt hoch …' : 'Protokoll hochladen'}
          </button>
          <span className="text-xs text-maja-muted">PDF, JPG oder PNG</span>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
