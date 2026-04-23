import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import type { AppUser, AusgefuelltesFormular, FormularTemplate } from '../../types/db';

interface Row extends AusgefuelltesFormular {
  fahrer?: { user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null } | null;
  template?: Pick<FormularTemplate, 'name'> | null;
}

export function EingaengePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('ausgefuellte_formulare')
        .select(
          '*, fahrer:fahrer_id (user:user_id (email, vorname, nachname)), template:template_id (name)',
        )
        .order('created_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as unknown as Row[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Eingänge werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Eingänge</h1>
        <p className="text-sm text-maja-muted">
          Zuletzt bearbeitete und eingereichte Protokolle (max. 50).
        </p>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Template</th>
              <th className="px-4 py-3 font-semibold">Fahrer</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Erstellt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Formulare erfasst.
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">{r.template?.name ?? '—'}</td>
                <td className="px-4 py-3 text-maja-muted">
                  {displayName(r.fahrer?.user ?? null)}
                </td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
