import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import type { FormularTemplate, Fahrer, Auftraggeber } from '../types/db';

interface TemplateRow extends FormularTemplate {
  auftraggeber?: Pick<Auftraggeber, 'name' | 'kuerzel'> | null;
}

export function FahrerDashboard() {
  const { session } = useAuth();
  const [fahrer, setFahrer] = useState<Fahrer | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      const { data: fahrerRow, error: fahrerErr } = await supabase
        .from('fahrer')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (fahrerErr) {
        if (!cancelled) { setError(fahrerErr.message); setLoading(false); }
        return;
      }

      const { data: tpls, error: tplErr } = await supabase
        .from('formular_templates')
        .select('*, auftraggeber:auftraggeber_id (name, kuerzel)')
        .eq('is_active', true)
        .order('name');
      if (cancelled) return;
      if (tplErr) {
        setError(tplErr.message);
      } else {
        setFahrer(fahrerRow);
        setTemplates((tpls as unknown as TemplateRow[]) ?? []);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [session]);

  if (loading) return <Spinner label="Formulare werden geladen …" />;
  if (error)  return <ErrorBox message={error} />;

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
              {t.beschreibung && (
                <p className="mt-1 text-sm text-maja-muted">{t.beschreibung}</p>
              )}
              <div className="mt-4">
                <button className="btn-primary w-full" disabled title="Formular-Engine folgt in Phase 2">
                  Protokoll starten
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}
