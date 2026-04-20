import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MajaLogo } from '../components/Brand';

export function PasswordNewPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (password !== confirm) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-maja-light via-white to-maja-light">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
        <div className="w-full">
          <div className="mb-8 flex justify-center"><MajaLogo className="h-12" /></div>
          <div className="card p-8">
            <h1 className="mb-1 text-2xl font-semibold text-maja-navy">Neues Passwort festlegen</h1>
            <p className="mb-6 text-sm text-maja-muted">Mindestens 8 Zeichen.</p>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="pwd" className="label">Neues Passwort</label>
                <input id="pwd" type="password" required className="input"
                       value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pwd2" className="label">Passwort wiederholen</label>
                <input id="pwd2" type="password" required className="input"
                       value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && (
                <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Speichern …' : 'Passwort speichern'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
