import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MajaLogo } from './Brand';

interface NavItem { to: string; label: string }

const fahrerNav: NavItem[] = [
  { to: '/', label: 'Meine Formulare' },
  { to: '/offen', label: 'Begonnen' },
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
              <div className="hidden text-right text-xs sm:block">
                <div className="font-medium text-maja-ink">{profile.full_name ?? profile.email}</div>
                <div className="text-maja-muted">{profile.role === 'admin' ? 'Admin' : 'Fahrer'}</div>
              </div>
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
