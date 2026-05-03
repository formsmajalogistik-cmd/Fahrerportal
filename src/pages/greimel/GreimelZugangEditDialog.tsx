import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import type { AppUser, Fahrer, GreimelZugang } from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  initial: GreimelZugang | null;
  onClose: () => void;
  onSaved: () => void;
}

export function GreimelZugangEditDialog({ initial, onClose, onSaved }: Props) {
  const isNew = !initial;
  const [titel, setTitel]               = useState(initial?.titel ?? '');
  const [benutzername, setBenutzername] = useState(initial?.benutzername ?? '');
  const [passwort, setPasswort]         = useState(initial?.passwort ?? '');
  const [showPasswort, setShowPasswort] = useState(false);
  const [link, setLink]                 = useState(initial?.link ?? '');
  const [sichtbarFuerAlle, setSichtbarFuerAlle] = useState(initial?.sichtbar_fuer_alle ?? false);
  const [fahrerIds, setFahrerIds]       = useState<string[]>(
    Array.isArray(initial?.fahrer_ids) ? initial!.fahrer_ids : [],
  );

  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('fahrer')
        .select('*, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true);
      const list = Array.isArray(data) ? (data as unknown as FahrerWithUser[]) : [];
      list.sort((a, b) => displayName(a.user ?? null).localeCompare(displayName(b.user ?? null), 'de'));
      setFahrer(list);
    })();
  }, []);

  function toggleFahrer(id: string) {
    setFahrerIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!titel.trim() || !benutzername.trim() || !passwort.trim()) {
      setError('Titel, Benutzername und Passwort sind Pflichtfelder.');
      return;
    }
    setError(null);
    setSaving(true);
    const payload = {
      titel: titel.trim(),
      benutzername: benutzername.trim(),
      passwort,
      link: link.trim() || null,
      sichtbar_fuer_alle: sichtbarFuerAlle,
      fahrer_ids: sichtbarFuerAlle ? [] : fahrerIds,
    };
    const { error: err } = isNew
      ? await supabase.from('greimel_zugaenge').insert(payload)
      : await supabase.from('greimel_zugaenge').update(payload).eq('id', initial!.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-lg p-6">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-maja-navy">
            {isNew ? 'Neuen Zugang anlegen' : 'Zugang bearbeiten'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Schließen"
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="g-titel" className="label">Titel *</label>
            <input id="g-titel" className="input" required
                   value={titel} onChange={(e) => setTitel(e.target.value)} />
          </div>

          <div>
            <label htmlFor="g-user" className="label">Benutzername *</label>
            <input id="g-user" className="input" required autoComplete="off"
                   value={benutzername} onChange={(e) => setBenutzername(e.target.value)} />
          </div>

          <div>
            <label htmlFor="g-pw" className="label">Passwort *</label>
            <div className="relative">
              <input
                id="g-pw"
                className="input pr-10"
                type={showPasswort ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={passwort}
                onChange={(e) => setPasswort(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPasswort((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-maja-muted hover:bg-maja-light"
                aria-label={showPasswort ? 'Passwort verbergen' : 'Passwort anzeigen'}
              >
                {showPasswort ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="g-link" className="label">Link (optional)</label>
            <input id="g-link" className="input" type="url" placeholder="https://..."
                   value={link} onChange={(e) => setLink(e.target.value)} />
          </div>

          <div className="space-y-2 rounded-lg border border-maja-navy/10 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                checked={sichtbarFuerAlle}
                onChange={(e) => setSichtbarFuerAlle(e.target.checked)}
              />
              Für alle Fahrer sichtbar
            </label>

            {!sichtbarFuerAlle && (
              <div>
                <div className="mb-1 text-xs text-maja-muted">
                  Fahrer auswählen, die diesen Zugang sehen dürfen:
                </div>
                {fahrer.length === 0 ? (
                  <p className="text-sm text-maja-muted">Keine Fahrer verfügbar.</p>
                ) : (
                  <div className="max-h-48 overflow-auto rounded-md border border-maja-navy/10 bg-white p-2">
                    {fahrer.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 px-1.5 py-1 text-sm hover:bg-maja-light/60">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                          checked={fahrerIds.includes(f.id)}
                          onChange={() => toggleFahrer(f.id)}
                        />
                        <span>{displayName(f.user ?? null)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 4C5.5 4 2 8 2 10c0 2 3.5 6 8 6s8-4 8-6c0-2-3.5-6-8-6zm0 9.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm0-2a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l1.6 1.6C2.5 6.05 1.5 7.4 1.5 8.5c0 1.8 3.4 5.5 8.5 5.5 1.36 0 2.6-.27 3.7-.7l2.02 2.02a.75.75 0 101.06-1.06L3.28 2.22zM10 12.5c-1.93 0-3.5-1.57-3.5-3.5 0-.55.13-1.07.36-1.53l1.16 1.16a2 2 0 002.85 2.85l1.16 1.16c-.46.23-.98.36-1.53.36zM10 5.5c1.93 0 3.5 1.57 3.5 3.5 0 .49-.1.95-.28 1.37l1.62 1.62c1.4-1.18 2.16-2.49 2.16-3 0-1.8-3.4-5.5-8.5-5.5-.6 0-1.18.06-1.74.16l1.61 1.61c.21-.06.43-.07.63-.07z" />
    </svg>
  );
}
