import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/Spinner';

export function ProfilPage() {
  const { profile, refreshProfile, updatePassword } = useAuth();
  const navigate = useNavigate();

  const [vorname, setVorname]   = useState(profile?.vorname ?? '');
  const [nachname, setNachname] = useState(profile?.nachname ?? '');
  const [telefon, setTelefon]   = useState(profile?.telefon ?? '');
  const [position, setPosition] = useState(profile?.position ?? '');
  const [saveGallery, setSaveGallery] = useState<boolean>(!!profile?.save_to_gallery);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg]       = useState<string | null>(null);
  const [profileErr, setProfileErr]       = useState<string | null>(null);

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  if (!profile) return <Spinner label="Profil wird geladen …" />;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setProfileErr(null);
    setProfileMsg(null);
    setSavingProfile(true);
    // RPC mit SECURITY DEFINER — funktioniert auch für Fahrer (deren RLS-Policy
    // sonst keinen UPDATE auf app_users erlaubt).
    const { error } = await supabase.rpc('update_my_profile', {
      p_vorname: vorname.trim() || null,
      p_nachname: nachname.trim() || null,
      p_save_to_gallery: saveGallery,
      p_telefon: telefon.trim() || null,
      p_position: position.trim() || null,
    });
    setSavingProfile(false);
    if (error) { setProfileErr(error.message); return; }
    setProfileMsg('Profil gespeichert.');
    window.setTimeout(() => setProfileMsg((m) => m === 'Profil gespeichert.' ? null : m), 3000);
    await refreshProfile();
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (pw1.length < 8) { setPwErr('Das Passwort muss mindestens 8 Zeichen lang sein.'); return; }
    if (pw1 !== pw2)    { setPwErr('Die Passwörter stimmen nicht überein.'); return; }
    setSavingPw(true);
    try {
      await updatePassword(pw1);
      setPwMsg('Passwort aktualisiert.');
      setPw1(''); setPw2('');
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen');
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-sm text-maja-accent hover:underline">
            ← Zurück
          </button>
          <h1 className="mt-1 text-2xl font-semibold text-maja-navy">Profil</h1>
          <p className="text-sm text-maja-muted">Persönliche Einstellungen verwalten.</p>
        </div>
      </div>

      <form onSubmit={saveProfile} className="card space-y-4 p-5" noValidate>
        <h2 className="text-sm font-semibold text-maja-navy">Persönliche Daten</h2>

        <div>
          <label className="label">E-Mail</label>
          <input className="input bg-maja-light" value={profile.email} disabled readOnly />
          <p className="mt-1 text-xs text-maja-muted">
            Die E-Mail-Adresse kann nur über Supabase Auth geändert werden.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="p-vorname" className="label">Vorname</label>
            <input id="p-vorname" className="input" value={vorname}
                   onChange={(e) => setVorname(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-nachname" className="label">Nachname</label>
            <input id="p-nachname" className="input" value={nachname}
                   onChange={(e) => setNachname(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-telefon" className="label">Telefon</label>
            <input id="p-telefon" className="input" type="tel"
                   placeholder="z.B. 0173 8727757"
                   value={telefon}
                   onChange={(e) => setTelefon(e.target.value)} />
            <p className="mt-1 text-xs text-maja-muted">
              Wird in der E-Mail-Signatur angezeigt.
            </p>
          </div>
          <div>
            <label htmlFor="p-position" className="label">Position / Rolle</label>
            <input id="p-position" className="input"
                   placeholder="Maja-Logistik"
                   value={position}
                   onChange={(e) => setPosition(e.target.value)} />
            <p className="mt-1 text-xs text-maja-muted">
              Erscheint unter dem Namen in der E-Mail-Signatur. Default „Maja-Logistik".
            </p>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-maja-navy/15 bg-maja-light/50 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={saveGallery}
            onChange={(e) => setSaveGallery(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium text-maja-ink">
              Aufgenommene Fotos auch in der Geräte-Galerie speichern
            </span>
            <span className="block text-xs text-maja-muted">
              Wenn aktiviert, wird beim Aufnehmen eines Fotos ein Download
              ausgelöst, sodass das Bild in der Galerie deines Geräts landet.
            </span>
          </span>
        </label>

        {profileErr && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {profileErr}
          </div>
        )}
        {profileMsg && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {profileMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Speichern …' : 'Profil speichern'}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className="card space-y-4 p-5" noValidate>
        <h2 className="text-sm font-semibold text-maja-navy">Passwort ändern</h2>

        <div>
          <label htmlFor="p-pw1" className="label">Neues Passwort</label>
          <input id="p-pw1" type="password" className="input" autoComplete="new-password"
                 value={pw1} onChange={(e) => setPw1(e.target.value)} />
        </div>
        <div>
          <label htmlFor="p-pw2" className="label">Passwort wiederholen</label>
          <input id="p-pw2" type="password" className="input" autoComplete="new-password"
                 value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>

        {pwErr && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {pwErr}
          </div>
        )}
        {pwMsg && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {pwMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingPw || !pw1 || !pw2}>
            {savingPw ? 'Speichern …' : 'Passwort speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}
