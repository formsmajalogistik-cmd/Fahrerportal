import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MajaLogo } from './Brand';
import { ProfilMenu } from './ProfilMenu';
import { OfflineBanner } from './OfflineBanner';
import { PdfPreviewProvider } from './PdfPreviewProvider';
import { TestModeBanner } from './TestModeBanner';
import { useAuth } from '../auth/AuthContext';
import { useTestMode } from '../auth/TestModeContext';

interface NavItem { to: string; label: string }

// Auftraggeber-Profile sehen NUR diese zwei Reiter — alle anderen
// Routen sind in App.tsx gar nicht erst registriert (Redirect auf
// /touren).
const auftraggeberNav: NavItem[] = [
  { to: '/touren',    label: 'Tourenliste' },
  { to: '/formulare', label: 'Formulare' },
];

export function AuftraggeberShell({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { isTestUser } = useTestMode();
  // Ohne verknüpften Auftraggeber liefert die Kundensicht (RLS:
  // auftraggeber_id = current_auftraggeber_id()) systembedingt KEINE
  // Zeilen. Statt einer stillen leeren Liste zeigen wir den Grund.
  // Test-Profile wählen ihren Auftraggeber im Banner — dort nicht nötig.
  const ohneZuordnung = !isTestUser
    && profile?.role === 'auftraggeber'
    && !profile?.auftraggeber_id;

  return (
    <div className="min-h-screen bg-maja-light">
      <TestModeBanner />
      <OfflineBanner />
      <header className="sticky top-0 z-10 border-b border-maja-navy/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 lg:px-8">
          <MajaLogo className="h-9" />
          <ProfilMenu />
        </div>
        <nav className="mx-auto max-w-screen-2xl overflow-x-auto px-2 lg:px-6">
          <ul className="flex gap-1 py-1">
            {auftraggeberNav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `inline-block rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-maja-navy text-white'
                        : 'text-maja-navy hover:bg-maja-light'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        {ohneZuordnung && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <div className="font-semibold">Diesem Konto ist kein Auftraggeber zugeordnet.</div>
            <p className="mt-1">
              Deshalb werden hier keine Touren und Formulare angezeigt. Bitte
              wenden Sie sich an den Administrator, damit die Zuordnung
              ergänzt wird.
            </p>
          </div>
        )}
        {children}
      </main>
      <PdfPreviewProvider />
    </div>
  );
}
