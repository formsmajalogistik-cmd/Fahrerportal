import { useFahrerContext } from '../auth/FahrerContext';
import { useAuth } from '../auth/AuthContext';
import { displayName, fahrerName } from '../lib/names';
import { MajaLogo } from '../components/Brand';

export function KontoAuswahlPage() {
  const { availableFahrer, setActive } = useFahrerContext();
  const { profile, signOut } = useAuth();

  const items = availableFahrer.map((f) => ({
    fahrer: f,
    label: fahrerName(f, profile),
    subtitle: f.ist_unterkonto ? 'Unterkonto' : 'Haupt-Konto',
  }));

  return (
    <div className="min-h-screen bg-maja-light px-4 py-12">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex justify-center">
          <MajaLogo className="h-10" />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-semibold text-maja-navy">Konto auswählen</h1>
          <p className="mt-1 text-sm text-maja-muted">
            Angemeldet als <span className="font-medium">{displayName(profile)}</span>.
            Wähle das Konto, mit dem du arbeiten möchtest.
          </p>
          <ul className="mt-4 space-y-2">
            {items.map(({ fahrer, label, subtitle }) => (
              <li key={fahrer.id}>
                <button
                  type="button"
                  onClick={() => setActive(fahrer.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left transition hover:border-maja-navy hover:bg-maja-light"
                >
                  <div>
                    <div className="font-medium text-maja-navy">{label}</div>
                    <div className="text-xs text-maja-muted">{subtitle}</div>
                  </div>
                  <span aria-hidden="true" className="text-maja-accent">→</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={signOut}
            className="mt-6 w-full text-center text-sm font-medium text-maja-muted hover:text-maja-navy hover:underline"
          >
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}
