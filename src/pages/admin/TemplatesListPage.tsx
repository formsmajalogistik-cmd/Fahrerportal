import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TemplateNewDialog } from './TemplateNewDialog';
import type { Auftraggeber, FormularTemplate } from '../../types/db';

interface Row extends FormularTemplate {
  auftraggeber?: Pick<Auftraggeber, 'name'> | null;
}

export function TemplatesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFahrzeugDialog, setShowFahrzeugDialog] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

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
        field_mapping: {},
      })
      .select('id')
      .single();
    if (err || !data) { setError(err?.message ?? 'Anlegen fehlgeschlagen'); return; }
    navigate(`/templates/${data.id}`);
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

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Noch keine Templates angelegt. Nutze „Neues Template" (leeres Gerüst)
          oder „Fahrzeugprotokoll anlegen" (Maja-Logistik-Standard).
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => {
            const sectionCount = t.schema?.sections?.length ?? 0;
            const fieldCount = (t.schema?.sections ?? []).reduce(
              (acc, s) => acc + (s.fields?.length ?? 0), 0,
            );
            return (
              <li key={t.id} className="card flex flex-col p-5">
                <div className="text-xs font-medium uppercase tracking-wide text-maja-accent">
                  {t.auftraggeber?.name ?? 'ohne Auftraggeber'}
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
              Bestehende Zuweisungen werden automatisch entfernt.
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
