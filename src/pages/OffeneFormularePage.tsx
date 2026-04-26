import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { deleteFormularPhotos } from '../lib/photo';
import type { AusgefuelltesFormular, FormularTemplate } from '../types/db';

interface DraftRow extends AusgefuelltesFormular {
  template?: Pick<FormularTemplate, 'name'> | null;
}

export function OffeneFormularePage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DraftRow | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const { data: fahrerRow } = await supabase
      .from('fahrer')
      .select('id')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (!fahrerRow) { setRows([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('ausgefuellte_formulare')
      .select('*, template:template_id (name)')
      .eq('fahrer_id', fahrerRow.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setRows((data as unknown as DraftRow[]) ?? []);
    setLoading(false);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(r: DraftRow) {
    if (!session) throw new Error('Nicht angemeldet');
    // Storage-Cleanup zuerst — dann der DB-Eintrag.
    await deleteFormularPhotos(session.user.id, r.id);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare').delete().eq('id', r.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  if (loading) return <Spinner label="Begonnene Formulare werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Begonnene Formulare</h1>
        <p className="text-sm text-maja-muted">
          Entwürfe, die du noch nicht eingereicht hast.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">Keine offenen Entwürfe.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-maja-navy">{r.template?.name ?? 'Formular'}</div>
                <div className="text-xs text-maja-muted">
                  Begonnen: {new Date(r.created_at).toLocaleString('de-DE')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/formular/${r.id}`} className="btn-secondary">Fortsetzen</Link>
                <button
                  onClick={() => setDeleting(r)}
                  className="text-sm font-medium text-red-600 hover:underline"
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Formular löschen?"
          message={
            <>
              Möchten Sie dieses Formular wirklich löschen?
              Alle eingegebenen Daten gehen verloren.
              {deleting.template?.name && (
                <div className="mt-2 text-xs text-maja-muted">
                  Template: {deleting.template.name}
                </div>
              )}
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
