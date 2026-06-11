import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName, fahrerName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FahrerEditDialog } from './FahrerEditDialog';
import { useAuth } from '../../auth/AuthContext';
import { deleteAccount } from '../../lib/accountApi';
import type { AppUser, Fahrer, UserRole } from '../../types/db';

interface FahrerRow extends Fahrer {
  user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}

/**
 * Eine Zeile der Konten-Verwaltung. Bündelt den app_users-Eintrag mit
 * optionalem Haupt-Fahrer-Eintrag und (falls vorhanden) Unterkonten.
 */
interface AccountRow {
  user: AppUser;
  fahrer: FahrerRow | null;
  subs: FahrerRow[];
}

export function FahrerListPage() {
  const { profile: me, refreshProfile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [fahrerRows, setFahrerRows] = useState<FahrerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FahrerRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [deletingSub, setDeletingSub] = useState<FahrerRow | null>(null);
  const [roleChange, setRoleChange] = useState<{ user: AppUser; next: UserRole } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newSubName, setNewSubName] = useState<Record<string, { vorname: string; nachname: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [u, f] = await Promise.all([
      supabase.from('app_users').select('*').order('email'),
      supabase.from('fahrer')
        .select('*, user:user_id (email, vorname, nachname)')
        .order('ist_unterkonto', { ascending: true })
        .order('aktiv', { ascending: false }),
    ]);
    if (u.error) setError(u.error.message);
    else setUsers((u.data as AppUser[]) ?? []);
    if (f.error) setError(f.error.message);
    else setFahrerRows((f.data as unknown as FahrerRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accounts: AccountRow[] = useMemo(() => {
    const hauptByUser = new Map<string, FahrerRow>();
    const subsByHaupt = new Map<string, FahrerRow[]>();
    for (const f of fahrerRows) {
      if (f.ist_unterkonto && f.haupt_user_id) {
        const arr = subsByHaupt.get(f.haupt_user_id) ?? [];
        arr.push(f);
        subsByHaupt.set(f.haupt_user_id, arr);
      } else if (!f.ist_unterkonto) {
        hauptByUser.set(f.user_id, f);
      }
    }
    return users.map((u) => {
      const haupt = hauptByUser.get(u.id) ?? null;
      const subs = haupt ? (subsByHaupt.get(haupt.id) ?? []) : [];
      return { user: u, fahrer: haupt, subs };
    });
  }, [users, fahrerRows]);

  const adminCount = useMemo(
    () => users.filter((u) => u.role === 'admin').length,
    [users],
  );

  // Mögliche Übertragungs-Ziele beim Löschen: alle HAUPT-Fahrer ANDERER
  // Konten. Unterkonten kommen nicht in Frage, weil sie technisch ein
  // anderes Konto als Eigentümer haben.
  const transferOptions = useMemo(() => {
    if (!deleting) return [];
    const excludeUserId = deleting.user.id;
    return fahrerRows
      .filter((f) => !f.ist_unterkonto && f.user_id !== excludeUserId)
      .map((f) => ({
        id: f.id,
        label: `${fahrerName(f, f.user ?? null)} (${f.user?.email ?? '—'})`,
      }));
  }, [deleting, fahrerRows]);

  async function handleDeleteSub(f: FahrerRow) {
    // Unterkonten: Referenzen aufs Haupt-Konto umhängen (FK-NOT-NULL).
    if (f.haupt_user_id) {
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
    setDeletingSub(null);
    void load();
  }

  async function handleDeleteAccount(acc: AccountRow) {
    await deleteAccount(acc.user.id, transferTarget || null);
    setDeleting(null);
    setTransferTarget('');
    void load();
  }

  async function handleRoleChange(user: AppUser, next: UserRole) {
    const { error: err } = await supabase
      .from('app_users')
      .update({ role: next })
      .eq('id', user.id);
    if (err) throw err;
    setRoleChange(null);
    if (me?.id === user.id) await refreshProfile();
    void load();
  }

  async function handleAddUnterkonto(h: FahrerRow) {
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

  if (loading) return <Spinner label="Konten werden geladen …" />;
  if (error && users.length === 0) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Konten</h1>
          <p className="text-sm text-maja-muted">
            Admins und Fahrer verwalten. Rollen wechseln, Unterkonten anlegen,
            Konten löschen.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          Fahrer-Profil anlegen
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
              <th className="px-4 py-3 font-semibold">Rolle</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Unterkonten</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {accounts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Konten angelegt.
              </td></tr>
            ) : accounts.map((acc) => {
              const u = acc.user;
              const f = acc.fahrer;
              const subs = acc.subs;
              const isOpen = expanded.has(u.id);
              const subInput = (f && newSubName[f.id]) ?? { vorname: '', nachname: '' };
              const isSelf = me?.id === u.id;
              const isLastAdmin = u.role === 'admin' && adminCount <= 1;
              const targetRole: UserRole = u.role === 'admin' ? 'fahrer' : 'admin';
              const roleLockReason = isSelf
                ? 'Du kannst deine eigene Rolle nicht ändern.'
                : (u.role === 'admin' && isLastAdmin
                    ? 'Mindestens ein Admin muss existieren.'
                    : null);
              const deleteLockReason = isSelf
                ? 'Du kannst dein eigenes Konto nicht löschen.'
                : (u.role === 'admin' && isLastAdmin
                    ? 'Mindestens ein Admin muss existieren.'
                    : null);

              return (
                <RowFragment key={u.id}>
                  <tr className="hover:bg-maja-light/50">
                    <td className="px-4 py-3 font-medium text-maja-ink">
                      {displayName(u)}
                    </td>
                    <td className="px-4 py-3 text-maja-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!!roleLockReason}
                        title={roleLockReason ?? `Zu „${targetRole}" wechseln`}
                        onClick={() => setRoleChange({ user: u, next: targetRole })}
                        className={
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium '
                          + (u.role === 'admin'
                            ? 'bg-maja-navy/10 text-maja-navy hover:bg-maja-navy/15'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200')
                          + (roleLockReason ? ' cursor-not-allowed opacity-60' : '')
                        }
                      >
                        {u.role === 'admin' ? 'Admin' : 'Fahrer'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {f ? (
                        <span className={
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                          (f.aktiv
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-200 text-gray-600')
                        }>
                          {f.aktiv ? 'aktiv' : 'inaktiv'}
                        </span>
                      ) : (
                        <span className="text-xs text-maja-muted">kein Fahrer-Profil</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {f ? (
                        subs.length > 0 ? (
                          <button
                            onClick={() => toggleExpanded(u.id)}
                            className="inline-flex items-center gap-1 rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy hover:bg-maja-navy/10"
                          >
                            {subs.length} Unterkonten {isOpen ? '▲' : '▼'}
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleExpanded(u.id)}
                            className="text-xs font-medium text-maja-accent hover:underline"
                          >
                            + hinzufügen
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-maja-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {f && (
                        <button
                          className="text-sm font-medium text-maja-accent hover:underline"
                          onClick={() => setEditing(f)}
                        >Bearbeiten</button>
                      )}
                      <button
                        disabled={!!deleteLockReason}
                        title={deleteLockReason ?? 'Konto löschen'}
                        className={
                          'ml-3 text-sm font-medium '
                          + (deleteLockReason
                            ? 'text-maja-muted cursor-not-allowed'
                            : 'text-red-600 hover:underline')
                        }
                        onClick={() => {
                          if (deleteLockReason) return;
                          setTransferTarget('');
                          setDeleting(acc);
                        }}
                      >Löschen</button>
                    </td>
                  </tr>
                  {isOpen && f && (
                    <tr className="bg-maja-light/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="space-y-2">
                          {subs.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                              <div className="text-sm text-maja-ink">
                                {fahrerName(s, f.user ?? null)}
                                {!s.aktiv && <span className="ml-2 text-xs text-maja-muted">(inaktiv)</span>}
                              </div>
                              <button
                                onClick={() => setDeletingSub(s)}
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
                </RowFragment>
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

      {deletingSub && (
        <ConfirmDialog
          title="Unterkonto löschen?"
          message={
            <>
              Soll das Unterkonto „<strong>{fahrerName(deletingSub, deletingSub.user ?? null)}</strong>"
              gelöscht werden? Verknüpfte Touren und Formulare werden dem
              zugehörigen Hauptkonto zugeordnet.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDeleteSub(deletingSub)}
          onClose={() => setDeletingSub(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Konto „${displayName(deleting.user)}" löschen?`}
          message={
            <>
              Das Konto (E-Mail <strong>{deleting.user.email}</strong>,
              Rolle <strong>{deleting.user.role === 'admin' ? 'Admin' : 'Fahrer'}</strong>)
              wird unwiderruflich gelöscht — inklusive aller Unterkonten und
              dem Supabase-Auth-Zugang.
              <div className="mt-3">
                <label htmlFor="transfer-target" className="label">
                  Touren und Formulare übertragen an:
                </label>
                <select
                  id="transfer-target"
                  className="input"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                >
                  <option value="">— Niemanden (Touren auf NULL setzen) —</option>
                  {transferOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-maja-muted">
                  Hinweis: Bereits eingereichte Formulare brauchen ein
                  Übertragungs-Konto — sie können nicht auf „Niemanden"
                  gesetzt werden.
                </p>
              </div>
            </>
          }
          confirmLabel="Konto löschen"
          destructive
          onConfirm={() => handleDeleteAccount(deleting)}
          onClose={() => { setDeleting(null); setTransferTarget(''); }}
        />
      )}

      {roleChange && (
        <ConfirmDialog
          title={
            roleChange.next === 'admin'
              ? `${displayName(roleChange.user)} zum Admin machen?`
              : `${displayName(roleChange.user)} zum Fahrer herabstufen?`
          }
          message={
            roleChange.next === 'admin'
              ? 'Die Person erhält Zugriff auf alle Verwaltungsfunktionen (Touren, Rechnungen, E-Mails, Einstellungen).'
              : 'Die Person verliert den Zugriff auf alle Admin-Bereiche.'
          }
          confirmLabel="Rolle ändern"
          destructive={roleChange.next === 'fahrer'}
          onConfirm={() => handleRoleChange(roleChange.user, roleChange.next)}
          onClose={() => setRoleChange(null)}
        />
      )}
    </div>
  );
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
