import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import type { AppUser, Fahrer, FormularZuweisung } from '../../types/db';

interface FahrerRow extends Fahrer {
  user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}
interface TemplateOption {
  id: string;
  name: string;
}
interface ZuweisungRow extends FormularZuweisung {
  fahrer?: FahrerRow | null;
  template?: TemplateOption | null;
}

export function ZuweisungenPage() {
  const [rows, setRows] = useState<ZuweisungRow[]>([]);
  const [fahrer, setFahrer] = useState<FahrerRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [fahrerId, setFahrerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: z, error: zErr }, { data: f }, { data: t }] = await Promise.all([
      supabase
        .from('formular_zuweisungen')
        .select(
          '*, fahrer:fahrer_id (id, user_id, aktiv, user:user_id (email, vorname, nachname)), template:template_id (name)',
        )
        .order('id'),
      supabase
        .from('fahrer')
        .select('*, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true),
      supabase.from('formular_templates').select('id, name').order('name'),
    ]);
    if (zErr) setError(zErr.message);
    else setRows((z as unknown as ZuweisungRow[]) ?? []);
    setFahrer((f as unknown as FahrerRow[]) ?? []);
    setTemplates(t ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!fahrerId || !templateId) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('formular_zuweisungen')
      .insert({ fahrer_id: fahrerId, template_id: templateId });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setFahrerId(''); setTemplateId('');
    void load();
  }

  async function handleDelete(id: string) {
    const { error: err } = await supabase
      .from('formular_zuweisungen').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    void load();
  }

  if (loading) return <Spinner label="Zuweisungen werden geladen …" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Zuweisungen</h1>
        <p className="text-sm text-maja-muted">
          Welche Templates darf welcher Fahrer ausfüllen?
        </p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="zu-fahrer" className="label">Fahrer</label>
            <select id="zu-fahrer" className="input" required
                    value={fahrerId} onChange={(e) => setFahrerId(e.target.value)}>
              <option value="">— auswählen —</option>
              {fahrer.map((f) => (
                <option key={f.id} value={f.id}>
                  {displayName(f.user ?? null)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="zu-template" className="label">Template</label>
            <select id="zu-template" className="input" required
                    value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">— auswählen —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary" disabled={saving || !fahrerId || !templateId}>
            {saving ? 'Speichern …' : 'Zuweisen'}
          </button>
        </div>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Fahrer</th>
              <th className="px-4 py-3 font-semibold">Template</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Zuweisungen.
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">
                  {displayName(r.fahrer?.user ?? null)}
                </td>
                <td className="px-4 py-3 text-maja-muted">{r.template?.name ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
