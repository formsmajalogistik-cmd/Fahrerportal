import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import type { Auftraggeber, Fahrer, FormularTemplate } from '../types/db';

interface TemplateRow extends FormularTemplate {
  auftraggeber?: Pick<Auftraggeber, 'name'> | null;
}

export function FahrerDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [fahrer, setFahrer] = useState<Fahrer | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);

    const { data: fahrerRow, error: fahrerErr } = await supabase
      .from('fahrer')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (fahrerErr) { setError(fahrerErr.message); setLoading(false); return; }

    // RLS liefert uns ohnehin nur zugewiesene Templates
    const { data: tpls, error: tplErr } = await supabase
      .from('formular_templates')
      .select('*, auftraggeber:auftraggeber_id (name)')
      .order('name');
    if (tplErr) setError(tplErr.message);
    else setTemplates((tpls as unknown as TemplateRow[]) ?? []);
    setFahrer(fahrerRow);
    setLoading(false);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  async function startNew(template: TemplateRow) {
    if (!fahrer) return;
    setStarting(template.id);
    const { data, error: err } = await supabase
      .from('ausgefuellte_formulare')
      .insert({ fahrer_id: fahrer.id, template_id: template.id, daten: {} })
      .select('id')
      .single();
    setStarting(null);
    if (err || !data) { setError(err?.message ?? 'Anlegen fehlgeschlagen'); return; }
    navigate(`/formular/${data.id}`);
  }

  if (loading) return <Spinner label="Formulare werden geladen …" />;
  if (error)  return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  if (!fahrer) {
    return (
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-maja-navy">Kein Fahrer-Profil zugeordnet</h2>
        <p className="text-sm text-maja-muted">
          Dein Account ist angemeldet, aber es ist noch kein Fahrer-Profil verknüpft.
          Bitte wende dich an die Administration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Meine Formulare</h1>
        <p className="text-sm text-maja-muted">
          Zugewiesene Protokolle, die du ausfüllen kannst.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Dir sind aktuell keine Formulare zugewiesen.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="card p-5 transition hover:shadow-lg">
              <div className="text-xs font-medium uppercase tracking-wide text-maja-accent">
                {t.auftraggeber?.name ?? 'Maja-Logistik'}
              </div>
              <h3 className="mt-1 text-base font-semibold text-maja-navy">{t.name}</h3>
              <div className="mt-1 text-xs text-maja-muted">
                {(t.schema?.sections ?? []).length} Sektionen
              </div>
              <div className="mt-4">
                <button
                  className="btn-primary w-full"
                  onClick={() => startNew(t)}
                  disabled={starting === t.id}
                >
                  {starting === t.id ? 'Wird angelegt …' : 'Protokoll starten'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
