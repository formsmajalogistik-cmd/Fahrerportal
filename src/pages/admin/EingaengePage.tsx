import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { useAuth } from '../../auth/AuthContext';
import { useEingaengeNotifications } from '../../sync/EingaengeContext';
import {
  asPdfPathList, deleteFormPdf, downloadFormPdf, expectedOneDrivePath,
  generateAndUploadFormPdfs, generateAndUploadZwischenprotokoll,
  previewFormPdf, resolveFilename,
  type PdfPathEntry,
} from '../../lib/pdfGenerate';
import {
  DownloadIcon, EyeIcon, FileTextIcon, MailIcon, RefreshIcon, XIcon,
} from '../../components/icons';
import { formatGermanDate, summarizeEingang } from '../../lib/eingangData';
import { EingangLinkDialog } from './EingangLinkDialog';
import { EingangResendEmailDialog } from './EingangResendEmailDialog';
import type {
  AppUser, AusgefuelltesFormular, FormularTemplate, TemplatePdf,
} from '../../types/db';

interface Row extends AusgefuelltesFormular {
  fahrer?: {
    user_id: string;
    user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
  } | null;
  template?:
    & Pick<FormularTemplate, 'id' | 'name' | 'email_config'>
    & { pdfs: TemplatePdf[]; schema: unknown }
    | null;
  /** Verknüpfte Tour (oder null). */
  tour?: { id: string; tour_id: string | null } | null;
  zwischenprotokoll_url: string | null;
  zwischenprotokoll_erstellt_am: string | null;
}

export function EingaengePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { markAllSeen } = useEingaengeNotifications();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regen, setRegen] = useState<string | null>(null);
  const [linking, setLinking] = useState<Row | null>(null);
  const [resending, setResending] = useState<Row | null>(null);
  const [hideLinked, setHideLinked] = useState(true);
  const [linkToast, setLinkToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // 1. Eingänge laden inkl. Template-Stammdaten
    const { data, error: err } = await supabase
      .from('ausgefuellte_formulare')
      .select(`
        *,
        fahrer:fahrer_id (user_id, user:user_id (email, vorname, nachname)),
        template:template_id (id, name, pdfs, schema, email_config)
      `)
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) { setError(err.message); setLoading(false); return; }
    const list = (data as unknown as Row[]) ?? [];
    // 2. Verknüpfte Touren je Eingang nachladen.
    const ids = list.map((r) => r.id);
    let tourMap = new Map<string, { id: string; tour_id: string | null }>();
    if (ids.length > 0) {
      const { data: tdata } = await supabase
        .from('touren')
        .select('id, tour_id, eingang_id')
        .in('eingang_id', ids);
      for (const t of tdata ?? []) {
        if (t.eingang_id) tourMap.set(t.eingang_id, { id: t.id, tour_id: t.tour_id });
      }
    }
    setRows(list.map((r) => ({ ...r, tour: tourMap.get(r.id) ?? null })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Beim Öffnen des Reiters: alle bisher ungesehenen Eingänge als
  // gesehen markieren — das rote Badge in der Navigation verschwindet
  // damit sofort. Läuft nur einmal pro Mount, Fehler still ignorieren.
  useEffect(() => {
    if (!isAdmin) return;
    void markAllSeen();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const visibleRows = useMemo(() => {
    return hideLinked ? rows.filter((r) => !r.tour) : rows;
  }, [rows, hideLinked]);

  async function regeneratePdfs(r: Row) {
    if (!r.template) return;
    setRegen(r.id);
    try {
      const tpl: FormularTemplate = {
        id: r.template_id,
        name: r.template.name ?? '',
        schema: (r.template.schema as FormularTemplate['schema']) ?? { sections: [] },
        pdfs: r.template.pdfs ?? [],
        email_config: null,
        sichtbar: true,
      };
      const generated = await generateAndUploadFormPdfs(tpl, r);
      // pdf_paths wurde von generateAndUploadFormPdfs persistiert — wir
      // patchen den lokalen State, damit die UI sofort die aktuelle
      // Liste zeigt (übersprungene PDFs sind weg).
      const paths: PdfPathEntry[] = generated.map((g) => ({
        pdf_id: g.pdf.id, pdf_name: g.pdf.name,
        filename: g.filename, onedrive_path: g.onedrive_path,
      }));
      // Manuelle Generierung war erfolgreich → eventuellen Fehlerstatus
      // der Auto-Generierung zurücksetzen.
      try {
        await supabase.from('ausgefuellte_formulare')
          .update({ pdf_status: 'ok', pdf_fehler: null })
          .eq('id', r.id);
      } catch { /* nicht kritisch */ }
      await patchRowInState(r.id, {
        pdf_paths: paths as unknown as AusgefuelltesFormular['pdf_paths'],
        pdf_status: 'ok',
        pdf_fehler: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-Generierung fehlgeschlagen');
    } finally {
      setRegen(null);
    }
  }

  async function patchRowInState(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  if (loading) return <Spinner label="Eingänge werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  const linkedCount = rows.filter((r) => !!r.tour).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Eingänge</h1>
          <p className="text-sm text-maja-muted">
            {isAdmin
              ? 'Alle Protokolle. Mit Tour verknüpfen oder PDF-Downloads aus OneDrive.'
              : 'Deine Protokolle. PDF-Downloads holen die Datei aus OneDrive.'}
          </p>
        </div>
        {linkedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-maja-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
              checked={hideLinked}
              onChange={(e) => setHideLinked(e.target.checked)}
            />
            Verknüpfte ausblenden ({linkedCount})
          </label>
        )}
      </div>

      {visibleRows.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          {hideLinked && rows.length > 0
            ? 'Alle Eingänge sind bereits mit Touren verknüpft.'
            : 'Noch keine Formulare erfasst.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map((r) => (
            <EingangCard
              key={r.id}
              row={r}
              isAdmin={isAdmin}
              regenBusy={regen === r.id}
              onRegenerate={() => void regeneratePdfs(r)}
              onLink={() => setLinking(r)}
              onResendEmail={() => setResending(r)}
              onZwischenChanged={(patch) => void patchRowInState(r.id, patch)}
            />
          ))}
        </ul>
      )}

      {linking && isAdmin && (
        <EingangLinkDialog
          formular={linking}
          template={linking.template ? {
            id: linking.template.id,
            name: linking.template.name,
          } : null}
          onClose={() => setLinking(null)}
          onLinked={(filled) => {
            setLinking(null);
            void load();
            if (filled.length > 0) {
              setLinkToast(`${filled.join(' & ')} aus Protokoll übernommen.`);
            } else {
              setLinkToast('Tour verknüpft.');
            }
            window.setTimeout(() => setLinkToast(null), 4000);
          }}
        />
      )}

      {resending && isAdmin && resending.template && (() => {
        const t = resending.template;
        const tpl: FormularTemplate = {
          id: t.id,
          name: t.name ?? '',
          schema: (t.schema as FormularTemplate['schema']) ?? { sections: [] },
          pdfs: t.pdfs ?? [],
          email_config: t.email_config ?? null,
          sichtbar: true,
        };
        return (
          <EingangResendEmailDialog
            formular={resending}
            template={tpl}
            onClose={() => setResending(null)}
            onSent={() => {
              setResending(null);
              setLinkToast('E-Mail erneut versendet.');
              window.setTimeout(() => setLinkToast(null), 4000);
            }}
          />
        );
      })()}

      {linkToast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {linkToast}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  row: Row;
  isAdmin: boolean;
  regenBusy: boolean;
  onRegenerate: () => void;
  onLink: () => void;
  onResendEmail: () => void;
  onZwischenChanged: (patch: Partial<Row>) => void;
}

function EingangCard({
  row, isAdmin, regenBusy, onRegenerate, onLink, onResendEmail, onZwischenChanged,
}: CardProps) {
  const summary = useMemo(() => summarizeEingang(row), [row]);
  const fahrer = displayName(row.fahrer?.user ?? null) || summary.fahrername || '—';
  const tpl: FormularTemplate | null = row.template ? {
    id: row.template_id,
    name: row.template.name ?? '',
    schema: (row.template.schema as FormularTemplate['schema']) ?? { sections: [] },
    pdfs: row.template.pdfs ?? [],
    email_config: row.template.email_config ?? null,
    sichtbar: true,
  } : null;

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-maja-navy">
              {summary.kennzeichen ?? row.template?.name ?? 'Eingang'}
            </h3>
            <span className={
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
              (row.status === 'submitted'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800')
            }>
              {row.status === 'submitted' ? 'eingereicht' : 'Entwurf'}
            </span>
            {row.tour && (
              <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                Verknüpft{row.tour.tour_id ? ` · ${row.tour.tour_id}` : ''}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-maja-muted">
            {row.template?.name ?? '—'}
            {' · '}{formatGermanDate(summary.datum) || formatGermanDate(row.created_at)}
          </div>

          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Detail label="Fahrer">{fahrer}</Detail>
            {summary.kundenname && <Detail label="Kunde">{summary.kundenname}</Detail>}
            {summary.fin && <Detail label="FIN" mono>{summary.fin}</Detail>}
            {summary.adresseUebernahme && (
              <Detail label="Übernahme" full>{summary.adresseUebernahme}</Detail>
            )}
            {summary.adresseUebergabe && (
              <Detail label="Übergabe" full>{summary.adresseUebergabe}</Detail>
            )}
          </dl>

          {isAdmin && row.pdf_status === 'fehlgeschlagen' && (
            <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>PDFs konnten nicht automatisch generiert werden.</strong>{' '}
              Bitte unten „PDFs neu erzeugen" nutzen.
              {row.pdf_fehler && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  Fehler: {row.pdf_fehler}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {isAdmin && row.status === 'submitted' && !row.tour && (
            <button type="button" onClick={onLink} className="btn-primary text-sm">
              Mit Tour verknüpfen
            </button>
          )}
          {row.status === 'submitted' && tpl && (
            <PdfDownloads template={tpl} formular={row} />
          )}
          {isAdmin && row.status === 'draft' && tpl && (
            <ZwischenprotokollSection
              template={tpl}
              formular={row}
              onChanged={onZwischenChanged}
            />
          )}
          {isAdmin && row.status === 'submitted' && tpl && (tpl.pdfs?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={onResendEmail}
              className="inline-flex items-center gap-1 rounded-full bg-maja-navy px-3 py-1 text-xs font-medium text-white hover:bg-maja-accent"
              title="E-Mail mit PDFs erneut senden"
            >
              <MailIcon className="h-3.5 w-3.5" /> E-Mail erneut senden
            </button>
          )}
          {isAdmin && row.status === 'submitted' && (row.template?.pdfs ?? []).some((p) => p.path) && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenBusy}
              className="text-xs font-medium text-maja-accent hover:underline"
            >
              {regenBusy ? 'Generiere …' : 'PDFs neu erzeugen'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Detail({
  label, children, mono, full,
}: { label: string; children: React.ReactNode; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-maja-muted">{label}</dt>
      <dd className={'text-sm text-maja-ink' + (mono ? ' font-mono' : '')}>{children}</dd>
    </div>
  );
}

/**
 * Liefert die Liste der tatsächlich vorhandenen PDFs für einen Eingang.
 * Bevorzugt das persistierte pdf_paths-Feld (neu seit Migration 037);
 * für Legacy-Eingänge ohne pdf_paths fallback auf alle Template-PDFs
 * (vorherige Logik). So bleiben alte Eingänge weiter downloadbar.
 */
function effectivePdfList(
  template: FormularTemplate, formular: Row,
): Array<{ id: string; name: string; filename: string; onedrive_path: string }> {
  const persisted = asPdfPathList((formular as unknown as { pdf_paths?: unknown }).pdf_paths);
  if (persisted.length > 0) {
    return persisted.map((p) => ({
      id: p.pdf_id, name: p.pdf_name, filename: p.filename, onedrive_path: p.onedrive_path,
    }));
  }
  return (template.pdfs ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    filename: resolveFilename(p.filename_pattern, formular.daten, p.id),
    onedrive_path: expectedOneDrivePath(template, formular, p),
  }));
}

function PdfDownloads({
  template, formular,
}: { template: FormularTemplate; formular: Row }) {
  const list = effectivePdfList(template, formular);
  if (list.length === 0) {
    return <span className="text-xs text-maja-muted">keine PDFs erzeugt</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {list.map((p) => (
        <PdfDownloadButton
          key={p.id}
          label={p.name}
          filename={p.filename}
          path={p.onedrive_path}
          formularId={formular.id}
        />
      ))}
    </div>
  );
}

function PdfDownloadButton({
  label, filename, path, formularId,
}: { label: string; filename: string; path: string; formularId: string }) {
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null);
  async function download() {
    setBusy('download');
    const ok = await downloadFormPdf(path, filename, formularId);
    setBusy(null);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar. Beim Einreichen werden die PDFs automatisch erzeugt.');
  }
  async function preview() {
    setBusy('preview');
    const ok = await previewFormPdf(path, formularId);
    setBusy(null);
    if (!ok) alert('PDF konnte nicht geöffnet werden. Beim Einreichen werden die PDFs automatisch erzeugt.');
  }
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-full bg-maja-light text-xs text-maja-navy">
      <button
        type="button"
        onClick={preview}
        disabled={busy !== null}
        className="flex items-center px-2 py-1 hover:bg-maja-accent/20"
        title={`Vorschau: ${filename}`}
        aria-label="Vorschau"
      >
        {busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={download}
        disabled={busy !== null}
        className="flex items-center gap-1 border-l border-maja-navy/10 px-2 py-1 hover:bg-maja-accent/20"
        title={`Download: ${filename}\n${path}`}
      >
        {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
        {label}
      </button>
    </span>
  );
}

function ZwischenprotokollSection({
  template, formular, onChanged,
}: {
  template: FormularTemplate;
  formular: Row;
  onChanged: (patch: Partial<Row>) => void;
}) {
  const [busy, setBusy] = useState<'create' | 'preview' | 'download' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existing = formular.zwischenprotokoll_url;

  async function generate() {
    setBusy('create');
    setError(null);
    try {
      const { path, erstellt_am } = await generateAndUploadZwischenprotokoll(template, formular);
      const { error: err } = await supabase
        .from('ausgefuellte_formulare')
        .update({ zwischenprotokoll_url: path, zwischenprotokoll_erstellt_am: erstellt_am })
        .eq('id', formular.id);
      if (err) throw err;
      onChanged({ zwischenprotokoll_url: path, zwischenprotokoll_erstellt_am: erstellt_am });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erzeugung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!existing) return;
    setBusy('preview');
    const ok = await previewFormPdf(existing, formular.id);
    setBusy(null);
    if (!ok) setError('Vorschau fehlgeschlagen.');
  }

  async function download() {
    if (!existing) return;
    setBusy('download');
    const ok = await downloadFormPdf(existing, 'zwischenprotokoll.pdf', formular.id);
    setBusy(null);
    if (!ok) setError('Download fehlgeschlagen.');
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Zwischenprotokoll wirklich löschen?')) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteFormPdf(existing, formular.id);
      const { error: err } = await supabase
        .from('ausgefuellte_formulare')
        .update({ zwischenprotokoll_url: null, zwischenprotokoll_erstellt_am: null })
        .eq('id', formular.id);
      if (err) throw err;
      onChanged({ zwischenprotokoll_url: null, zwischenprotokoll_erstellt_am: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const erstelltLabel = formular.zwischenprotokoll_erstellt_am
    ? new Date(formular.zwischenprotokoll_erstellt_am).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {!existing ? (
        <button
          type="button"
          onClick={generate}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900 hover:bg-amber-200"
          title="PDF mit aktuellem Bearbeitungsstand erzeugen"
        >
          {busy === 'create' ? 'Erzeuge …' : (
            <>
              <FileTextIcon className="h-3.5 w-3.5" />
              Zwischenprotokoll erstellen
            </>
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-maja-muted">
            Zwischenprotokoll vom {erstelltLabel ?? '?'}
          </span>
          <span className="inline-flex items-stretch overflow-hidden rounded-full bg-amber-50 text-amber-900">
            <button
              type="button"
              onClick={preview}
              disabled={busy !== null}
              className="flex items-center px-2 py-1 hover:bg-amber-100"
              title="Vorschau"
              aria-label="Vorschau"
            >{busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}</button>
            <button
              type="button"
              onClick={download}
              disabled={busy !== null}
              className="flex items-center gap-1 border-l border-amber-200 px-2 py-1 hover:bg-amber-100"
            >
              {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
              Download
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy !== null}
              className="flex items-center gap-1 border-l border-amber-200 px-2 py-1 hover:bg-amber-100"
              title="Mit aktuellem Stand neu erzeugen"
            >
              {busy === 'create' ? <span>…</span> : <RefreshIcon className="h-4 w-4" />}
              Neu
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              className="flex items-center px-2 py-1 text-red-700 hover:bg-red-50"
              aria-label="Löschen"
            >{busy === 'delete' ? <span>…</span> : <XIcon className="h-4 w-4" />}</button>
          </span>
        </div>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}
