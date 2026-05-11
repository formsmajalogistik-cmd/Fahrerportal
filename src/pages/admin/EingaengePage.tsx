import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { useAuth } from '../../auth/AuthContext';
import {
  downloadFormPdf, expectedOneDrivePath, generateAndUploadFormPdfs, resolveFilename,
} from '../../lib/pdfGenerate';
import { formatGermanDate, summarizeEingang } from '../../lib/eingangData';
import { EingangLinkDialog } from './EingangLinkDialog';
import type {
  AppUser, Auftraggeber, AusgefuelltesFormular, FormularTemplate, TemplatePdf,
} from '../../types/db';

interface Row extends AusgefuelltesFormular {
  fahrer?: {
    user_id: string;
    user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
  } | null;
  template?:
    & Pick<FormularTemplate, 'id' | 'name' | 'auftraggeber_id'>
    & {
      pdfs: TemplatePdf[];
      schema: unknown;
      auftraggeber?: Pick<Auftraggeber, 'name'> | null;
    }
    | null;
  /** Verknüpfte Tour (oder null). */
  tour?: { id: string; tour_id: string | null } | null;
}

export function EingaengePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regen, setRegen] = useState<string | null>(null);
  const [linking, setLinking] = useState<Row | null>(null);
  const [hideLinked, setHideLinked] = useState(true);
  const [linkToast, setLinkToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // 1. Eingänge laden inkl. Template + Auftraggeber-Name
    const { data, error: err } = await supabase
      .from('ausgefuellte_formulare')
      .select(`
        *,
        fahrer:fahrer_id (user_id, user:user_id (email, vorname, nachname)),
        template:template_id (
          id, name, pdfs, schema, auftraggeber_id,
          auftraggeber:auftraggeber_id (name)
        )
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
        auftraggeber_id: null,
        schema: (r.template.schema as FormularTemplate['schema']) ?? { sections: [] },
        pdfs: r.template.pdfs ?? [],
        email_config: null,
      };
      await generateAndUploadFormPdfs(tpl, r);
    } finally {
      setRegen(null);
    }
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
            auftraggeber_id: linking.template.auftraggeber_id ?? null,
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
}

function EingangCard({ row, isAdmin, regenBusy, onRegenerate, onLink }: CardProps) {
  const summary = useMemo(() => summarizeEingang(row), [row]);
  const fahrer = displayName(row.fahrer?.user ?? null) || summary.fahrername || '—';
  const auftraggeber = row.template?.auftraggeber?.name ?? null;
  const tpl: FormularTemplate | null = row.template ? {
    id: row.template_id,
    name: row.template.name ?? '',
    auftraggeber_id: null,
    schema: (row.template.schema as FormularTemplate['schema']) ?? { sections: [] },
    pdfs: row.template.pdfs ?? [],
    email_config: null,
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
            {auftraggeber && <Detail label="Auftraggeber">{auftraggeber}</Detail>}
            {summary.kundenname && <Detail label="Kunde">{summary.kundenname}</Detail>}
            {summary.fin && <Detail label="FIN" mono>{summary.fin}</Detail>}
            {summary.adresseUebernahme && (
              <Detail label="Übernahme" full>{summary.adresseUebernahme}</Detail>
            )}
            {summary.adresseUebergabe && (
              <Detail label="Übergabe" full>{summary.adresseUebergabe}</Detail>
            )}
          </dl>
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

function PdfDownloads({
  template, formular,
}: { template: FormularTemplate; formular: AusgefuelltesFormular }) {
  if (!template.pdfs || template.pdfs.length === 0) {
    return <span className="text-xs text-maja-muted">keine Vorlagen</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {template.pdfs.map((p) => {
        const filename = resolveFilename(p.filename_pattern, formular.daten, p.id);
        const path = expectedOneDrivePath(template, formular, p);
        return (
          <PdfDownloadButton
            key={p.id}
            label={p.name}
            filename={filename}
            path={path}
          />
        );
      })}
    </div>
  );
}

function PdfDownloadButton({
  label, filename, path,
}: { label: string; filename: string; path: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const ok = await downloadFormPdf(path, filename);
    setBusy(false);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar. Beim Einreichen werden die PDFs automatisch erzeugt.');
  }
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full bg-maja-light px-2 py-1 text-xs text-maja-navy hover:bg-maja-accent/20"
      title={`${filename}\n${path}`}
    >
      {busy ? '…' : '⬇'} {label}
    </button>
  );
}
