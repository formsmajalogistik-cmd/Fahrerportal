import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { useAuth } from '../../auth/AuthContext';
import {
  downloadFormPdf, expectedOneDrivePath, generateAndUploadFormPdfs, resolveFilename,
} from '../../lib/pdfGenerate';
import type {
  AppUser, AusgefuelltesFormular, FormularTemplate, TemplatePdf,
} from '../../types/db';

interface Row extends AusgefuelltesFormular {
  fahrer?: {
    user_id: string;
    user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
  } | null;
  template?:
    & Pick<FormularTemplate, 'name'>
    & { pdfs: TemplatePdf[]; schema: unknown }
    | null;
}

export function EingaengePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regen, setRegen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('ausgefuellte_formulare')
        .select(
          '*, fahrer:fahrer_id (user_id, user:user_id (email, vorname, nachname)), template:template_id (name, pdfs, schema)',
        )
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as unknown as Row[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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
      window.location.reload();
    } finally {
      setRegen(null);
    }
  }

  if (loading) return <Spinner label="Eingänge werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Eingänge</h1>
        <p className="text-sm text-maja-muted">
          {isAdmin
            ? 'Alle Protokolle. PDF-Downloads holen die Datei aus OneDrive.'
            : 'Deine Protokolle. PDF-Downloads holen die Datei aus OneDrive.'}
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Template</th>
              {isAdmin && <th className="px-4 py-3 font-semibold">Fahrer</th>}
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Erstellt</th>
              <th className="px-4 py-3 font-semibold">PDFs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Formulare erfasst.
              </td></tr>
            ) : rows.map((r) => {
              const tpl: FormularTemplate | null = r.template ? {
                id: r.template_id,
                name: r.template.name ?? '',
                auftraggeber_id: null,
                schema: (r.template.schema as FormularTemplate['schema']) ?? { sections: [] },
                pdfs: r.template.pdfs ?? [],
                email_config: null,
              } : null;
              return (
                <tr key={r.id} className="align-top hover:bg-maja-light/50">
                  <td className="px-4 py-3 font-medium text-maja-ink">{r.template?.name ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-maja-muted">
                      {displayName(r.fahrer?.user ?? null)}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                      (r.status === 'submitted'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800')
                    }>
                      {r.status === 'submitted' ? 'eingereicht' : 'Entwurf'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-maja-muted">
                    {new Date(r.created_at).toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'submitted' && tpl ? (
                      <PdfDownloads
                        template={tpl}
                        formular={r}
                      />
                    ) : (
                      <span className="text-xs text-maja-muted">—</span>
                    )}
                    {isAdmin && r.status === 'submitted' && (r.template?.pdfs ?? []).some((p) => p.path) && (
                      <button
                        onClick={() => void regeneratePdfs(r)}
                        disabled={regen === r.id}
                        className="mt-1 block text-xs font-medium text-maja-accent hover:underline"
                      >
                        {regen === r.id ? 'Generiere …' : 'PDFs neu erzeugen'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
    <div className="flex flex-wrap gap-2">
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
