import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import type { Fahrer } from '../../types/db';

export function FahrerListPage() {
  const [rows, setRows] = useState<Fahrer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('fahrer')
        .select('*')
        .order('nachname');
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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
        <button className="btn-primary" disabled title="Anlage folgt in Phase 2">
          Neuen Fahrer anlegen
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Personalnummer</th>
              <th className="px-4 py-3 font-semibold">Telefon</th>
              <th className="px-4 py-3 font-semibold">Status</th>
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
                  {f.vorname} {f.nachname}
                </td>
                <td className="px-4 py-3 text-maja-muted">{f.personalnummer ?? '—'}</td>
                <td className="px-4 py-3 text-maja-muted">{f.telefon ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                    (f.is_active
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-200 text-gray-600')
                  }>
                    {f.is_active ? 'aktiv' : 'inaktiv'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
