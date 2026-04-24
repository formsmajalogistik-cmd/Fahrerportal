import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { TemplateNewDialog } from './TemplateNewDialog';
import type { Auftraggeber, FormularTemplate } from '../../types/db';

interface Row extends FormularTemplate {
  auftraggeber?: Pick<Auftraggeber, 'name'> | null;
}

export function TemplatesListPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('formular_templates')
      .select('*, auftraggeber:auftraggeber_id (name)')
      .order('name');
    if (err) setError(err.message);
    else setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
            JSON-basierte Templates inkl. PDF-Mapping. Weitere Templates lassen
            sich direkt in Supabase anlegen
            (Tabelle <code className="rounded bg-maja-light px-1">formular_templates</code>).
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowDialog(true)}>
          Fahrzeugprotokoll anlegen
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Noch keine Templates angelegt. Du kannst oben das Maja-Logistik
          Standard-Fahrzeugprotokoll anlegen oder ein eigenes Template in
          Supabase einfügen (Beispiel: <code className="rounded bg-maja-light px-1 py-0.5">supabase/seed/fahrzeugprotokoll.sql</code>).
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => {
            const sectionCount = t.schema?.sections?.length ?? 0;
            const fieldCount = (t.schema?.sections ?? []).reduce(
              (acc, s) => acc + (s.fields?.length ?? 0), 0,
            );
            return (
              <li key={t.id} className="card p-5">
                <div className="text-xs font-medium uppercase tracking-wide text-maja-accent">
                  {t.auftraggeber?.name ?? 'Maja-Logistik'}
                </div>
                <h3 className="mt-1 text-base font-semibold text-maja-navy">{t.name}</h3>
                <div className="mt-2 text-xs text-maja-muted">
                  {sectionCount} Sektionen · {fieldCount} Felder
                </div>
                {t.pdf_template && (
                  <div className="mt-3">
                    <span className="inline-flex rounded-full bg-maja-light px-2 py-0.5 text-xs text-maja-navy">
                      PDF: {t.pdf_template}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showDialog && (
        <TemplateNewDialog
          onClose={() => setShowDialog(false)}
          onCreated={() => { setShowDialog(false); void load(); }}
        />
      )}
    </div>
  );
}
