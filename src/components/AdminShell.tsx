import { type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { displayName } from '../lib/names';
import { MajaLogo } from './Brand';

interface NavItem { to: string; label: string }

const adminNav: NavItem[] = [
  { to: '/',                label: 'Übersicht' },
  { to: '/meine-formulare', label: 'Meine Formulare' },
  { to: '/meine-drafts',    label: 'Begonnen' },
  { to: '/fahrer',          label: 'Fahrer' },
  { to: '/auftraggeber',    label: 'Auftraggeber' },
  { to: '/templates',       label: 'Templates' },
  { to: '/zuweisungen',     label: 'Zuweisungen' },
  { to: '/eingaenge',       label: 'Eingänge' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-maja-light">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-maja-navy/10 bg-white lg:block">
        <div className="px-5 py-5 border-b border-maja-navy/10">
          <MajaLogo className="h-9" />
        </div>
        <nav className="px-3 py-4">
          <ul className="space-y-1">
            {adminNav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-maja-navy text-white'
                        : 'text-maja-ink hover:bg-maja-light'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-maja-navy/10 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-3 lg:px-8">
            <div className="lg:hidden"><MajaLogo className="h-8" /></div>
            <div className="ml-auto flex items-center gap-3">
              {profile && (
                <Link
                  to="/profil"
                  className="hidden rounded-md px-2 py-1 text-right text-xs hover:bg-maja-light sm:block"
                  title="Profil und Einstellungen"
                >
                  <div className="font-medium text-maja-ink">
                    {displayName(profile)}
                  </div>
                  <div className="text-maja-muted">Admin</div>
                </Link>
              )}
              <button onClick={signOut} className="btn-secondary px-3 py-1.5 text-sm">
                Abmelden
              </button>
            </div>
          </div>
          <nav className="border-t border-maja-navy/10 px-2 lg:hidden">
            <ul className="flex gap-1 overflow-x-auto py-1">
              {adminNav.map((item) => (
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

        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
