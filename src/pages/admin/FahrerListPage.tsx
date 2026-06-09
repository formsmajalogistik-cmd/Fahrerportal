import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName, fahrerName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FahrerEditDialog } from './FahrerEditDialog';
import type { AppUser, Fahrer } from '../../types/db';

interface Row extends Fahrer {
  user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}

export function FahrerListPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newSubName, setNewSubName] = useState<Record<string, { vorname: string; nachname: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('fahrer')
      .select('*, user:user_id (email, vorname, nachname)')
      .order('ist_unterkonto', { ascending: true })
      .order('aktiv', { ascending: false });
    if (err) setError(err.message);
    else setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const haupt = useMemo(() => rows.filter((r) => !r.ist_unterkonto), [rows]);
  const subsByHaupt = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.ist_unterkonto || !r.haupt_user_id) continue;
      const arr = m.get(r.haupt_user_id) ?? [];
      arr.push(r);
      m.set(r.haupt_user_id, arr);
    }
    return m;
  }, [rows]);

  async function handleDelete(f: Row) {
    // Unterkonto-Spezialfall: vor dem Delete alle Referenzen auf das
    // Haupt-Konto umhängen, sonst blocken FK-Constraints (touren.
    // fahrer_id, ausgefuellte_formulare.fahrer_id NOT NULL).
    if (f.ist_unterkonto && f.haupt_user_id) {
      const { error: tErr } = await supabase
        .from('touren')
        .update({ fahrer_id: f.haupt_user_id })
        .eq('fahrer_id', f.id);
      if (tErr) throw new Error(`Touren übertragen: ${tErr.message}`);
      const { error: aErr } = await supabase
        .from('ausgefuellte_formulare')
        .update({ fahrer_id: f.haupt_user_id })
        .eq('fahrer_id', f.id);
      if (aErr) throw new Error(`Eingänge übertragen: ${aErr.message}`);
    }
    const { error: err } = await supabase.from('fahrer').delete().eq('id', f.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  async function handleAddUnterkonto(h: Row) {
    const v = newSubName[h.id] ?? { vorname: '', nachname: '' };
    const vn = v.vorname.trim();
    const nn = v.nachname.trim();
    if (!vn && !nn) { setError('Bitte einen Namen für das Unterkonto angeben.'); return; }
    setBusyId(h.id);
    setError(null);
    const { error: err } = await supabase.from('fahrer').insert({
      user_id: h.user_id,
      haupt_user_id: h.id,
      ist_unterkonto: true,
      vorname: vn || null,
      nachname: nn || null,
      aktiv: true,
    });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    setNewSubName({ ...newSubName, [h.id]: { vorname: '', nachname: '' } });
    void load();
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading) return <Spinner label="Fahrer werden geladen …" />;
  if (error && rows.length === 0) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Fahrer</h1>
          <p className="text-sm text-maja-muted">
            Fahrer-Stammdaten verwalten. Pro Fahrer können beliebige Unterkonten angelegt werden.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          Neuen Fahrer anlegen
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">E-Mail</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Unterkonten</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {haupt.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Fahrer angelegt.
              </td></tr>
            ) : haupt.map((f) => {
              const subs = subsByHaupt.get(f.id) ?? [];
              const isOpen = expanded.has(f.id);
              const subInput = newSubName[f.id] ?? { vorname: '', nachname: '' };
              return (
                <Row key={f.id}>
                  <tr className="hover:bg-maja-light/50">
                    <td className="px-4 py-3 font-medium text-maja-ink">
                      {displayName(f.user ?? null)}
                    </td>
                    <td className="px-4 py-3 text-maja-muted">{f.user?.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (f.aktiv
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-200 text-gray-600')
                      }>
                        {f.aktiv ? 'aktiv' : 'inaktiv'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {subs.length > 0 ? (
                        <button
                          onClick={() => toggleExpanded(f.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy hover:bg-maja-navy/10"
                        >
                          {subs.length} Unterkonten {isOpen ? '▲' : '▼'}
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleExpanded(f.id)}
                          className="text-xs font-medium text-maja-accent hover:underline"
                        >
                          + hinzufügen
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        className="text-sm font-medium text-maja-accent hover:underline"
                        onClick={() => setEditing(f)}
                      >Bearbeiten</button>
                      <button
                        className="ml-3 text-sm font-medium text-red-600 hover:underline"
                        onClick={() => setDeleting(f)}
                      >Löschen</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-maja-light/40">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="space-y-2">
                          {subs.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                              <div className="text-sm text-maja-ink">
                                {fahrerName(s, f.user ?? null)}
                                {!s.aktiv && <span className="ml-2 text-xs text-maja-muted">(inaktiv)</span>}
                              </div>
                              <button
                                onClick={() => setDeleting(s)}
                                className="text-xs font-medium text-red-600 hover:underline"
                              >Löschen</button>
                            </div>
                          ))}
                          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white px-3 py-2">
                            <div className="flex-1 min-w-[8rem]">
                              <label className="label">Vorname</label>
                              <input
                                className="input"
                                value={subInput.vorname}
                                onChange={(e) => setNewSubName({
                                  ...newSubName, [f.id]: { ...subInput, vorname: e.target.value },
                                })}
                              />
                            </div>
                            <div className="flex-1 min-w-[8rem]">
                              <label className="label">Nachname</label>
                              <input
                                className="input"
                                value={subInput.nachname}
                                onChange={(e) => setNewSubName({
                                  ...newSubName, [f.id]: { ...subInput, nachname: e.target.value },
                                })}
                              />
                            </div>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={busyId === f.id}
                              onClick={() => void handleAddUnterkonto(f)}
                            >
                              {busyId === f.id ? 'Speichern …' : '+ Unterkonto'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Row>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <FahrerEditDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={deleting.ist_unterkonto ? 'Unterkonto löschen?' : 'Fahrer löschen?'}
          message={
            <>
              Soll das {deleting.ist_unterkonto ? 'Unterkonto' : 'Fahrer-Profil'} von
              „<strong>{fahrerName(deleting, deleting.user ?? null)}</strong>" gelöscht werden?
              {!deleting.ist_unterkonto && (
                <> Damit werden auch alle Unterkonten dieses Fahrers entfernt.</>
              )}
              {' '}Das zugehörige Benutzerkonto in Supabase Auth bleibt bestehen.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
