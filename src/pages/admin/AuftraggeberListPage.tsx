import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import type { Auftraggeber } from '../../types/db';

export function AuftraggeberListPage() {
  const [rows, setRows] = useState<Auftraggeber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [kontakt, setKontakt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('auftraggeber').select('*').order('name');
    if (err) setError(err.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error: err } = await supabase
      .from('auftraggeber')
      .insert({ name, kontakt: kontakt || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setName(''); setKontakt(''); setShowForm(false);
    void load();
  }

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
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Abbrechen' : 'Neuen Auftraggeber anlegen'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ag-name" className="label">Name</label>
              <input id="ag-name" className="input" required
                     value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ag-kontakt" className="label">Kontakt</label>
              <input id="ag-kontakt" className="input"
                     value={kontakt} onChange={(e) => setKontakt(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={saving}>
              {saving ? 'Speichern …' : 'Anlegen'}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Kontakt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={2} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Auftraggeber angelegt.
              </td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">{a.name}</td>
                <td className="px-4 py-3 text-maja-muted">{a.kontakt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
