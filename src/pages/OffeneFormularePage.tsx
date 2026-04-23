import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import type { AusgefuelltesFormular, FormularTemplate } from '../types/db';

interface DraftRow extends AusgefuelltesFormular {
  template?: Pick<FormularTemplate, 'name'> | null;
}

export function OffeneFormularePage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: fahrerRow } = await supabase
        .from('fahrer')
        .select('id')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!fahrerRow) {
        if (!cancelled) { setRows([]); setLoading(false); }
        return;
      }
      const { data, error: err } = await supabase
        .from('ausgefuellte_formulare')
        .select('*, template:template_id (name)')
        .eq('fahrer_id', fahrerRow.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as unknown as DraftRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session]);

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
            <li key={r.id} className="card flex items-center justify-between p-4">
              <div>
                <div className="font-medium text-maja-navy">{r.template?.name ?? 'Formular'}</div>
                <div className="text-xs text-maja-muted">
                  Begonnen: {new Date(r.created_at).toLocaleString('de-DE')}
                </div>
              </div>
              <Link to={`/formular/${r.id}`} className="btn-secondary">Fortsetzen</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
