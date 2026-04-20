import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/Spinner';

interface Stats {
  fahrer: number;
  templates: number;
  offen: number;
  submitted: number;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fahrer, templates, offen, submitted] = await Promise.all([
        supabase.from('fahrer').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('formular_templates').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('ausgefuellte_formulare').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
        supabase.from('ausgefuellte_formulare').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      ]);
      if (cancelled) return;
      const firstErr = [fahrer, templates, offen, submitted].find((r) => r.error)?.error;
      if (firstErr) { setError(firstErr.message); return; }
      setStats({
        fahrer:    fahrer.count ?? 0,
        templates: templates.count ?? 0,
        offen:     offen.count ?? 0,
        submitted: submitted.count ?? 0,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!stats) return <Spinner label="Lade Übersicht …" />;

  const tiles = [
    { label: 'Aktive Fahrer',         value: stats.fahrer },
    { label: 'Aktive Templates',      value: stats.templates },
    { label: 'Offene Entwürfe',       value: stats.offen },
    { label: 'Eingereichte Protokolle', value: stats.submitted },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Übersicht</h1>
        <p className="text-sm text-maja-muted">Kennzahlen zum Business-Portal.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
              {t.label}
            </div>
            <div className="mt-2 text-3xl font-semibold text-maja-navy">{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
