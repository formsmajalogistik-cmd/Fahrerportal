import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TemplateNewDialog } from './TemplateNewDialog';
import { previewOneDrivePdf, triggerOneDriveDownload } from '../../lib/onedrive';
import { formatDateTime } from '../../lib/touren';
import { DownloadIcon, EyeIcon } from '../../components/icons';
import type { FormularTemplate, FormularWunsch } from '../../types/db';

type Row = FormularTemplate;

type WunschRow = FormularWunsch & {
  auftraggeber: { name: string } | null;
};

export function TemplatesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFahrzeugDialog, setShowFahrzeugDialog] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const [wuensche, setWuensche] = useState<WunschRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tplRes, wRes] = await Promise.all([
      supabase.from('formular_templates').select('*').order('name'),
      supabase.from('formular_wuensche')
        .select('*, auftraggeber:auftraggeber_id (name)')
        .order('created_at', { ascending: false }),
    ]);
    if (tplRes.error) setError(tplRes.error.message);
    else setRows((tplRes.data as unknown as Row[]) ?? []);
    // Wünsche-Tabelle existiert erst ab Migration 056 — Fehler hier
    // blockt die Templates-Liste nicht.
    setWuensche(wRes.error ? [] : ((wRes.data as unknown as WunschRow[]) ?? []));
    setLoading(false);
  }, []);

  async function markWunschErledigt(w: WunschRow) {
    const { error: err } = await supabase
      .from('formular_wuensche')
      .update({ status: 'erledigt' })
      .eq('id', w.id);
    if (err) { setError(err.message); return; }
    setWuensche((prev) => prev.map((x) => (x.id === w.id ? { ...x, status: 'erledigt' } : x)));
  }

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(t: Row) {
    const { error: err } = await supabase
      .from('formular_templates').delete().eq('id', t.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  async function handleCreateEmpty() {
    const { data, error: err } = await supabase
      .from('formular_templates')
      .insert({
        name: 'Neues Template',
        schema: { sections: [] },
        pdfs: [],
        email_config: null,
      })
      .select('id')
      .single();
    if (err || !data) { setError(err?.message ?? 'Anlegen fehlgeschlagen'); return; }
    navigate(`/templates/${data.id}`);
  }

  async function handleRestore(t: Row) {
    setRows((prev) => prev.map((r) => (r.id === t.id
      ? { ...r, archiviert: false, archiviert_am: null } : r)));
    const { error: err } = await supabase
      .from('formular_templates')
      .update({ archiviert: false, archiviert_am: null })
      .eq('id', t.id);
    if (err) {
      setError(err.message);
      setRows((prev) => prev.map((r) => (r.id === t.id ? t : r)));
    }
  }

  async function handleToggleSichtbar(t: Row) {
    const next = !t.sichtbar;
    setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, sichtbar: next } : r)));
    const { error: err } = await supabase
      .from('formular_templates')
      .update({ sichtbar: next })
      .eq('id', t.id);
    if (err) {
      setError(err.message);
      setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, sichtbar: t.sichtbar } : r)));
    }
  }

  if (loading) return <Spinner label="Templates werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Formular-Templates</h1>
          <p className="text-sm text-maja-muted">
            JSON-basierte Templates inkl. PDF-Mapping — direkt in der App anlegen und pflegen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => setShowFahrzeugDialog(true)}>
            Fahrzeugprotokoll anlegen
          </button>
          <button className="btn-primary" onClick={handleCreateEmpty}>
            Neues Template
          </button>
        </div>
      </div>

      {wuensche.length > 0 && (() => {
        const offen = wuensche.filter((w) => w.status === 'offen');
        return (
          <section className={`space-y-2 rounded-xl border p-4 ${
            offen.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-maja-navy/10 bg-white'
          }`}>
            <h2 className="text-sm font-semibold text-maja-navy">
              Formular-Wünsche ({offen.length} offen)
            </h2>
            <p className="text-xs text-maja-muted">
              Von Auftraggebern eingereichte PDF-Vorlagen — daraus Templates
              bauen und als erledigt markieren.
            </p>
            <ul className="space-y-2">
              {wuensche.map((w) => (
                <li key={w.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-maja-navy">
                        {w.auftraggeber?.name ?? 'Auftraggeber'}
                      </span>
                      <span className="text-xs text-maja-muted">{formatDateTime(w.created_at)}</span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        w.status === 'offen'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {w.status === 'offen' ? 'Offen' : 'Erledigt'}
                      </span>
                    </div>
                    {w.notiz && (
                      <p className="mt-1 text-xs text-maja-ink">{w.notiz}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WunschPdfButtons wunsch={w} />
                    {w.status === 'offen' && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs"
                        onClick={() => void markWunschErledigt(w)}
                      >
                        Als erledigt markieren
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {(() => {
        const active = rows.filter((t) => !t.archiviert);
        const archived = rows.filter((t) => t.archiviert);
        return (
      <>
      {active.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Noch keine Templates angelegt. Nutze „Neues Template" (leeres Gerüst)
          oder „Fahrzeugprotokoll anlegen" (Maja-Logistik-Standard).
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((t) => {
            const sectionCount = t.schema?.sections?.length ?? 0;
            const fieldCount = (t.schema?.sections ?? []).reduce(
              (acc, s) => acc + (s.fields?.length ?? 0), 0,
            );
            return (
              <li
                key={t.id}
                className={`card flex flex-col p-5 ${t.sichtbar ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-maja-navy">{t.name}</h3>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {t.ist_einmalig && (
                      <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                        Einmalig
                      </span>
                    )}
                    {!t.sichtbar && (
                      <span className="inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
                        Versteckt
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-maja-muted">
                  {sectionCount} Sektionen · {fieldCount} Felder
                </div>
                {(t.pdfs ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(t.pdfs ?? []).map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex rounded-full bg-maja-light px-2 py-0.5 text-xs text-maja-navy"
                        title={p.path ?? 'noch keine Datei hochgeladen'}
                      >
                        {p.name}{p.path == null && ' (leer)'}
                      </span>
                    ))}
                  </div>
                )}
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-maja-ink">
                  <input
                    type="checkbox"
                    checked={t.sichtbar}
                    onChange={() => void handleToggleSichtbar(t)}
                    className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-navy"
                  />
                  <span>Für Fahrer sichtbar</span>
                </label>
                <div className="mt-4 flex justify-between gap-2 pt-2 border-t border-maja-navy/10">
                  <Link
                    to={`/templates/${t.id}`}
                    className="text-sm font-medium text-maja-accent hover:underline"
                  >Bearbeiten</Link>
                  <button
                    onClick={() => setDeleting(t)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >Löschen</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="rounded-xl border border-maja-navy/10 bg-white">
          <button
            type="button"
            onClick={() => setArchivedOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            aria-expanded={archivedOpen}
          >
            <span className="text-sm font-semibold text-maja-navy">
              Archivierte Templates ({archived.length})
            </span>
            <span className="text-xs text-maja-muted">
              {archivedOpen ? 'Einklappen' : 'Ausklappen'}
            </span>
          </button>
          {archivedOpen && (
            <div className="border-t border-maja-navy/10 px-4 py-3">
              <p className="mb-2 text-xs text-maja-muted">
                Aus den Auswahllisten ausgeblendet, aber erhalten — eingereichte
                Formulare und PDFs funktionieren weiter. Bei Bedarf wiederherstellen.
              </p>
              <ul className="divide-y divide-maja-navy/10">
                {archived.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-maja-ink">{t.name}</span>
                      {t.archiviert_am && (
                        <span className="ml-2 text-xs text-maja-muted">
                          archiviert {formatDateTime(t.archiviert_am)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/templates/${t.id}`}
                        className="text-xs font-medium text-maja-accent hover:underline"
                      >Bearbeiten</Link>
                      <button
                        type="button"
                        onClick={() => void handleRestore(t)}
                        className="text-xs font-medium text-maja-navy hover:underline"
                      >Wiederherstellen</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      </>
        );
      })()}

      {showFahrzeugDialog && (
        <TemplateNewDialog
          onClose={() => setShowFahrzeugDialog(false)}
          onCreated={() => { setShowFahrzeugDialog(false); void load(); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Template löschen?"
          message={
            <>
              Soll das Template „<strong>{deleting.name}</strong>" gelöscht werden?
              Protokolle, die mit diesem Template ausgefüllt wurden, verhindern das Löschen.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function WunschPdfButtons({ wunsch }: { wunsch: FormularWunsch }) {
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const filename = wunsch.pdf_url.split('/').pop() ?? 'vorlage.pdf';
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy">
      <button
        type="button"
        disabled={busy !== null}
        onClick={async () => {
          setBusy('preview');
          const ok = await previewOneDrivePdf(wunsch.pdf_url, { filename });
          setBusy(null);
          if (!ok) alert('Vorschau fehlgeschlagen.');
        }}
        className="flex items-center px-2 py-1 hover:bg-maja-accent/20"
        aria-label="PDF ansehen"
      >{busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}</button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={async () => {
          setBusy('download');
          const ok = await triggerOneDriveDownload(wunsch.pdf_url, filename);
          setBusy(null);
          if (!ok) alert('PDF nicht erreichbar.');
        }}
        className="flex items-center gap-1 border-l border-slate-300 px-2 py-1 hover:bg-maja-accent/20"
      >
        {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
        {filename}
      </button>
    </span>
  );
}
