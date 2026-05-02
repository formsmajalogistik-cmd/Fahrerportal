import { type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { displayName, initials } from '../lib/names';
import { MajaLogo } from './Brand';

interface NavItem { to: string; label: string }

const fahrerNav: NavItem[] = [
  { to: '/', label: 'Meine Formulare' },
  { to: '/offen', label: 'Begonnen' },
  { to: '/eingaenge', label: 'Eingänge' },
  { to: '/touren', label: 'Tourenliste' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const nav = fahrerNav;

  return (
    <div className="min-h-screen bg-maja-light">
      <header className="sticky top-0 z-10 border-b border-maja-navy/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <MajaLogo className="h-9" />
          <div className="flex items-center gap-3">
            {profile && (
              <Link
                to="/profil"
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-maja-light"
                title="Profil und Einstellungen"
                aria-label="Profil"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-maja-navy text-xs font-semibold text-white">
                  {initials(profile)}
                </span>
                <span className="hidden text-right text-xs sm:block">
                  <span className="block font-medium text-maja-ink">{displayName(profile)}</span>
                  <span className="block text-maja-muted">
                    {profile.role === 'admin' ? 'Admin' : 'Fahrer'}
                  </span>
                </span>
              </Link>
            )}
            <button onClick={signOut} className="btn-secondary px-3 py-1.5 text-sm">
              Abmelden
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1 py-1">
            {nav.map((item) => (
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
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
