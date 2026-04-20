import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import type { Auftraggeber } from '../../types/db';

export function AuftraggeberListPage() {
  const [rows, setRows] = useState<Auftraggeber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('auftraggeber').select('*').order('name');
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Auftraggeber werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Auftraggeber</h1>
          <p className="text-sm text-maja-muted">Kunden verwalten.</p>
        </div>
        <button className="btn-primary" disabled>Neuen Auftraggeber anlegen</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Kürzel</th>
              <th className="px-4 py-3 font-semibold">Kontakt</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Auftraggeber angelegt.
              </td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">{a.name}</td>
                <td className="px-4 py-3 text-maja-muted">{a.kuerzel ?? '—'}</td>
                <td className="px-4 py-3 text-maja-muted">{a.kontakt ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                    (a.is_active
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-200 text-gray-600')
                  }>
                    {a.is_active ? 'aktiv' : 'inaktiv'}
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
