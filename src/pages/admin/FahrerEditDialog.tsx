import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { AppUser, Fahrer } from '../../types/db';

interface Props {
  initial: (Fahrer & { user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null }) | null;
  onClose: () => void;
  onSaved: () => void;
}

export function FahrerEditDialog({ initial, onClose, onSaved }: Props) {
  const isNew = !initial;
  const [candidates, setCandidates] = useState<AppUser[]>([]);
  const [userId, setUserId] = useState<string>(initial?.user_id ?? '');
  const [vorname, setVorname] = useState<string>(initial?.user?.vorname ?? '');
  const [nachname, setNachname] = useState<string>(initial?.user?.nachname ?? '');
  const [aktiv, setAktiv] = useState<boolean>(initial?.aktiv ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew) return;
    (async () => {
      // Alle app_users (Admin + Fahrer), die noch keinen HAUPT-Fahrer-Eintrag haben.
      // Unterkonten teilen sich user_id mit dem Haupt-Eintrag.
      const { data: existing } = await supabase
        .from('fahrer').select('user_id').eq('ist_unterkonto', false);
      const taken = new Set((existing ?? []).map((r) => r.user_id));
      const { data: users } = await supabase
        .from('app_users')
        .select('*')
        .order('email');
      setCandidates((users ?? []).filter((u) => !taken.has(u.id)));
    })();
  }, [isNew]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isNew) {
        if (!userId) throw new Error('Bitte einen Benutzer auswählen.');
        const { error: e1 } = await supabase
          .from('app_users')
          .update({ vorname: vorname || null, nachname: nachname || null })
          .eq('id', userId);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('fahrer')
          .insert({ user_id: userId, aktiv, ist_unterkonto: false, haupt_user_id: null });
        if (e2) throw e2;
      } else {
        const { error: e1 } = await supabase
          .from('app_users')
          .update({ vorname: vorname || null, nachname: nachname || null })
          .eq('id', initial!.user_id);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('fahrer')
          .update({ aktiv })
          .eq('id', initial!.id);
        if (e2) throw e2;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="mb-1 text-lg font-semibold text-maja-navy">
          {isNew ? 'Neuen Fahrer anlegen' : 'Fahrer bearbeiten'}
        </h2>
        <p className="mb-4 text-xs text-maja-muted">
          {isNew
            ? 'Wähle einen Benutzer (Admin oder Fahrer), der Formulare ausfüllen können soll. Das Konto muss vorher in Supabase Auth angelegt sein.'
            : 'Name wird im Benutzerprofil gespeichert.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {isNew && (
            <div>
              <label htmlFor="user" className="label">Benutzerkonto</label>
              <select
                id="user"
                required
                className="input"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  const c = candidates.find((x) => x.id === e.target.value);
                  if (c) {
                    setVorname(c.vorname ?? '');
                    setNachname(c.nachname ?? '');
                  }
                }}
              >
                <option value="">— auswählen —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.email}</option>
                ))}
              </select>
              {candidates.length === 0 && (
                <p className="mt-1 text-xs text-maja-muted">
                  Keine freien Benutzerkonten verfügbar. Lege sie zuerst in Supabase Auth an.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="vorname" className="label">Vorname</label>
              <input id="vorname" className="input" value={vorname}
                     onChange={(e) => setVorname(e.target.value)} />
            </div>
            <div>
              <label htmlFor="nachname" className="label">Nachname</label>
              <input id="nachname" className="input" value={nachname}
                     onChange={(e) => setNachname(e.target.value)} />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                   checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} />
            Fahrer ist aktiv
          </label>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
