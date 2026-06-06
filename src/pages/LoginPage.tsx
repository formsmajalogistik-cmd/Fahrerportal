import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MajaLogo } from '../components/Brand';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen';
      setError(msg.includes('Invalid') ? 'E-Mail oder Passwort ungültig.' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-maja-light via-white to-maja-light dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
        <div className="w-full">
          <div className="mb-8 flex justify-center">
            <MajaLogo className="h-12" />
          </div>

          <div className="card p-8 dark:border dark:border-slate-700">
            <h1 className="mb-1 text-2xl font-semibold text-maja-navy dark:text-slate-200">Anmelden</h1>
            <p className="mb-6 text-sm text-maja-muted dark:text-slate-400">
              Melde dich mit deiner geschäftlichen E-Mail-Adresse an.
            </p>

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

              <div>
                <label htmlFor="password" className="label">Passwort</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Anmelden …' : 'Anmelden'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <Link to="/passwort-reset" className="text-maja-accent hover:underline dark:text-blue-400">
                Passwort vergessen?
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-maja-muted dark:text-slate-500">
            © {new Date().getFullYear()} Maja-Logistik · Business-Portal
          </p>
        </div>
      </div>
    </div>
  );
}
