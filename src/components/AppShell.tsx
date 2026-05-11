import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MajaLogo } from './Brand';
import { ProfilMenu } from './ProfilMenu';

interface NavItem { to: string; label: string }

const fahrerNav: NavItem[] = [
  { to: '/touren',           label: 'Tourenliste' },
  { to: '/meine-formulare',  label: 'Formulare' },
  { to: '/greimel-zugaenge', label: 'Greimel Zugänge' },
  { to: '/eingaenge',        label: 'Eingänge' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const nav = fahrerNav;

  return (
    <div className="min-h-screen bg-maja-light">
      <header className="sticky top-0 z-10 border-b border-maja-navy/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <MajaLogo className="h-9" />
          <ProfilMenu />
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
