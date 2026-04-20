import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MajaLogo } from '../components/Brand';

export function PasswordResetPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus('sending');
    try {
      await requestPasswordReset(email.trim());
      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anfrage fehlgeschlagen');
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-maja-light via-white to-maja-light">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
        <div className="w-full">
          <div className="mb-8 flex justify-center"><MajaLogo className="h-12" /></div>
          <div className="card p-8">
            <h1 className="mb-1 text-2xl font-semibold text-maja-navy">Passwort zurücksetzen</h1>
            <p className="mb-6 text-sm text-maja-muted">
              Wir senden dir einen Link zum Zurücksetzen deines Passworts per E-Mail.
            </p>

            {status === 'sent' ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                Falls ein Konto mit dieser E-Mail existiert, findest du in Kürze eine Nachricht in deinem Postfach.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="email" className="label">E-Mail</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && (
                  <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <button type="submit" className="btn-primary w-full" disabled={status === 'sending'}>
                  {status === 'sending' ? 'Senden …' : 'Link senden'}
                </button>
              </form>
            )}

            <div className="mt-6 text-center text-sm">
              <Link to="/login" className="text-maja-accent hover:underline">
                Zurück zur Anmeldung
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
