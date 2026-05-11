import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { fahrerName } from '../lib/names';
import { Spinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Fahrer } from '../types/db';

export function MeineUnterkontenPage() {
  const { profile, session } = useAuth();
  const { availableFahrer, refresh } = useFahrerContext();

  const hauptFahrer = useMemo(
    () => availableFahrer.find((f) => !f.ist_unterkonto) ?? null,
    [availableFahrer],
  );
  const unterkonten = useMemo(
    () => availableFahrer.filter((f) => f.ist_unterkonto),
    [availableFahrer],
  );

  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [editing, setEditing] = useState<Fahrer | null>(null);
  const [deleting, setDeleting] = useState<Fahrer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTours, setLoadingTours] = useState(false);

  const handleCreate = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !hauptFahrer) return;
    const vn = vorname.trim();
    const nn = nachname.trim();
    if (!vn && !nn) {
      setError('Bitte mindestens Vor- oder Nachname angeben.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('fahrer')
      .insert({
        user_id: session.user.id,
        haupt_user_id: hauptFahrer.id,
        ist_unterkonto: true,
        vorname: vn || null,
        nachname: nn || null,
        aktiv: true,
      });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setVorname(''); setNachname('');
    await refresh();
  }, [session, hauptFahrer, vorname, nachname, refresh]);

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('fahrer')
      .update({
        vorname: editing.vorname?.trim() || null,
        nachname: editing.nachname?.trim() || null,
      })
      .eq('id', editing.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setEditing(null);
    await refresh();
  }

  async function handleDelete(f: Fahrer) {
    setLoadingTours(true);
    const { count, error: cntErr } = await supabase
      .from('touren')
      .select('id', { count: 'exact', head: true })
      .eq('fahrer_id', f.id);
    setLoadingTours(false);
    if (cntErr) { setError(cntErr.message); return; }
    if ((count ?? 0) > 0) {
      setError(`Diesem Unterkonto sind noch ${count} Touren zugeordnet. Bitte erst die Touren umweisen.`);
      return;
    }
    const { error: err } = await supabase.from('fahrer').delete().eq('id', f.id);
    if (err) { setError(err.message); return; }
    setDeleting(null);
    await refresh();
  }

  if (!profile || !hauptFahrer) {
    return (
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-maja-navy">
          Unterkonten nicht verfügbar
        </h2>
        <p className="text-sm text-maja-muted">
          Es ist noch kein Haupt-Fahrer-Profil mit deinem Account verknüpft.
          Bitte wende dich an die Administration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Meine Unterkonten</h1>
        <p className="text-sm text-maja-muted">
          Lege weitere Fahrer-Profile unter deinem Login an — z.B. für mehrere
          Personen, die unter demselben Account arbeiten.
        </p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          Unterkonto hinzufügen
        </h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="uk-vor" className="label">Vorname</label>
            <input id="uk-vor" className="input"
                   value={vorname} onChange={(e) => setVorname(e.target.value)} />
          </div>
          <div>
            <label htmlFor="uk-nach" className="label">Nachname</label>
            <input id="uk-nach" className="input"
                   value={nachname} onChange={(e) => setNachname(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Speichern …' : 'Hinzufügen'}
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
              <th className="px-4 py-3 font-semibold">Konto</th>
              <th className="px-4 py-3 font-semibold">Typ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            <tr>
              <td className="px-4 py-3 font-medium text-maja-ink">
                {fahrerName(hauptFahrer, profile)}
              </td>
              <td className="px-4 py-3 text-maja-muted">Haupt-Konto</td>
              <td className="px-4 py-3 text-right text-xs text-maja-muted">
                kann nicht hier bearbeitet werden
              </td>
            </tr>
            {unterkonten.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-maja-muted">
                  Du hast noch keine Unterkonten.
                </td>
              </tr>
            ) : unterkonten.map((f) => (
              <tr key={f.id} className="hover:bg-maja-light/50">
                <td className="px-4 py-3 font-medium text-maja-ink">
                  {fahrerName(f, profile)}
                  {!f.aktiv && <span className="ml-2 text-xs text-maja-muted">(inaktiv)</span>}
                </td>
                <td className="px-4 py-3 text-maja-muted">Unterkonto</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditing(f)}
                    className="text-sm font-medium text-maja-accent hover:underline"
                  >Umbenennen</button>
                  <button
                    onClick={() => setDeleting(f)}
                    className="ml-3 text-sm font-medium text-red-600 hover:underline"
                  >Löschen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-card">
            <h2 className="text-lg font-semibold text-maja-navy">Unterkonto umbenennen</h2>
            <div>
              <label className="label">Vorname</label>
              <input
                className="input"
                value={editing.vorname ?? ''}
                onChange={(e) => setEditing({ ...editing, vorname: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Nachname</label>
              <input
                className="input"
                value={editing.nachname ?? ''}
                onChange={(e) => setEditing({ ...editing, nachname: e.target.value })}
              />
            </div>
            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                Abbrechen
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Speichern …' : 'Speichern'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Unterkonto löschen?"
          message={
            <>
              Soll das Unterkonto „<strong>{fahrerName(deleting, profile)}</strong>" wirklich gelöscht werden?
              Bestehende Touren bleiben erhalten, verlieren aber die Fahrer-Zuordnung.
              {loadingTours && <div className="mt-2 text-xs text-maja-muted"><Spinner /></div>}
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
