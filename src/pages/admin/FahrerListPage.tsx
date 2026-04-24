import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FahrerEditDialog } from './FahrerEditDialog';
import type { AppUser, Fahrer } from '../../types/db';

interface Row extends Fahrer {
  user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}

export function FahrerListPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('fahrer')
      .select('*, user:user_id (email, vorname, nachname)')
      .order('aktiv', { ascending: false });
    if (err) setError(err.message);
    else setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(f: Row) {
    const { error: err } = await supabase.from('fahrer').delete().eq('id', f.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  if (loading) return <Spinner label="Fahrer werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Fahrer</h1>
          <p className="text-sm text-maja-muted">Fahrer-Stammdaten verwalten.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          Neuen Fahrer anlegen
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">E-Mail</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Fahrer angelegt.
              </td></tr>
            ) : rows.map((f) => (
              <tr key={f.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">
                  {displayName(f.user ?? null)}
                </td>
                <td className="px-4 py-3 text-maja-muted">{f.user?.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                    (f.aktiv
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-200 text-gray-600')
                  }>
                    {f.aktiv ? 'aktiv' : 'inaktiv'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    className="text-sm font-medium text-maja-accent hover:underline"
                    onClick={() => setEditing(f)}
                  >Bearbeiten</button>
                  <button
                    className="ml-3 text-sm font-medium text-red-600 hover:underline"
                    onClick={() => setDeleting(f)}
                  >Löschen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <FahrerEditDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Fahrer löschen?"
          message={
            <>
              Soll das Fahrer-Profil von
              „<strong>{displayName(deleting.user ?? null)}</strong>" gelöscht werden?
              Das zugehörige Benutzerkonto in Supabase Auth bleibt bestehen.
              Bereits abgegebene Protokolle dieses Fahrers werden nicht gelöscht.
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
