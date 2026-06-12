import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';

interface Props {
  templateId: string;
}

/**
 * Auftraggeber-Freigabe pro Template: Multi-Select, welche Auftraggeber
 * dieses Template sehen und ihren Touren zuweisen dürfen (Rolle
 * "auftraggeber", siehe Migration 056). Default: keine Freigabe.
 *
 * Änderungen werden SOFORT persistiert (insert/delete auf
 * template_auftraggeber_freigaben) — unabhängig vom Speichern-Button
 * des Template-Editors, damit das Dirty-Tracking unberührt bleibt.
 */
export function TemplateFreigabeEditor({ templateId }: Props) {
  const [auftraggeber, setAuftraggeber] = useState<Array<{ id: string; name: string }>>([]);
  const [freigegeben, setFreigegeben] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [agRes, frRes] = await Promise.all([
        supabase.from('auftraggeber').select('id, name').order('name'),
        supabase.from('template_auftraggeber_freigaben')
          .select('auftraggeber_id')
          .eq('template_id', templateId),
      ]);
      if (cancelled) return;
      if (agRes.error) setError(agRes.error.message);
      if (frRes.error) setError(frRes.error.message);
      setAuftraggeber((agRes.data as Array<{ id: string; name: string }>) ?? []);
      setFreigegeben(new Set((frRes.data ?? []).map((r) => r.auftraggeber_id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  async function toggle(agId: string) {
    setBusyId(agId);
    setError(null);
    const isOn = freigegeben.has(agId);
    if (isOn) {
      const { error: err } = await supabase
        .from('template_auftraggeber_freigaben')
        .delete()
        .eq('template_id', templateId)
        .eq('auftraggeber_id', agId);
      if (err) { setError(err.message); setBusyId(null); return; }
      setFreigegeben((prev) => { const n = new Set(prev); n.delete(agId); return n; });
    } else {
      const { error: err } = await supabase
        .from('template_auftraggeber_freigaben')
        .insert({ template_id: templateId, auftraggeber_id: agId });
      if (err) { setError(err.message); setBusyId(null); return; }
      setFreigegeben((prev) => new Set(prev).add(agId));
    }
    setBusyId(null);
  }

  if (loading) return <Spinner label="Freigaben werden geladen …" />;

  return (
    <div className="card space-y-3 p-5">
      <div>
        <h3 className="text-sm font-semibold text-maja-navy">Auftraggeber-Freigabe</h3>
        <p className="text-xs text-maja-muted">
          Auftraggeber-Profile sehen NUR Templates, die hier freigegeben
          sind, und können sie ihren Touren zuweisen. Änderungen werden
          sofort gespeichert.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {auftraggeber.length === 0 ? (
        <p className="text-sm text-maja-muted">Noch keine Auftraggeber angelegt.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {auftraggeber.map((a) => (
            <li key={a.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-maja-navy/15 bg-white px-3 py-2 text-sm text-maja-ink hover:bg-maja-light">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={freigegeben.has(a.id)}
                  disabled={busyId === a.id}
                  onChange={() => void toggle(a.id)}
                />
                {a.name}
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-maja-muted">
        {freigegeben.size === 0
          ? 'Aktuell für keinen Auftraggeber freigegeben.'
          : `Freigegeben für ${freigegeben.size} Auftraggeber.`}
      </p>
    </div>
  );
}
