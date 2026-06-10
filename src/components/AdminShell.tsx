import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MajaLogo } from './Brand';
import { ProfilMenu } from './ProfilMenu';
import { OfflineBanner } from './OfflineBanner';
import { PdfPreviewProvider } from './PdfPreviewProvider';
import { useEingaengeNotifications } from '../sync/EingaengeContext';

interface NavItem { to: string; label: string; end?: boolean }

/** Schlichter Punkt statt Zahlen-Badge — zeigt nur AN/AUS:
 *  „es gibt ungesehene Eingänge". */
function NavBadge({ count, pulse }: { count: number; pulse: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} ungesehene Eingänge`}
      className={`ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500 ${
        pulse ? 'animate-ping' : ''
      }`}
    />
  );
}

const adminNav: NavItem[] = [
  { to: '/touren',           label: 'Tourenliste' },
  { to: '/meine-formulare',  label: 'Formulare' },
  { to: '/greimel-zugaenge', label: 'Greimel Zugänge' },
  { to: '/eingaenge',        label: 'Eingänge' },
  { to: '/posteingang',      label: 'Posteingang' },
  { to: '/belege',           label: 'Belege' },
  { to: '/aufstellung',      label: 'Aufstellung' },
  { to: '/rechnungen',       label: 'Rechnungen' },
  { to: '/templates',        label: 'Templates' },
  { to: '/einstellungen',    label: 'Einstellungen' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { unseen, pulse } = useEingaengeNotifications();
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
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-maja-navy text-white'
                        : 'text-maja-ink hover:bg-maja-light'
                    }`
                  }
                >
                  <span>{item.label}</span>
                  {item.to === '/eingaenge' && <NavBadge count={unseen} pulse={pulse} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="lg:pl-64">
        <OfflineBanner />
        <header className="sticky top-0 z-10 border-b border-maja-navy/10 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-3 lg:px-8">
            <div className="lg:hidden"><MajaLogo className="h-8" /></div>
            <div className="ml-auto flex items-center gap-3">
              <ProfilMenu />
            </div>
          </div>
          <nav className="border-t border-maja-navy/10 px-2 lg:hidden">
            <ul className="flex gap-1 overflow-x-auto py-1">
              {adminNav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) =>
                      `inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-maja-navy text-white'
                          : 'text-maja-navy hover:bg-maja-light'
                      }`
                    }
                  >
                    <span>{item.label}</span>
                    {item.to === '/eingaenge' && <NavBadge count={unseen} pulse={pulse} />}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
      <PdfPreviewProvider />
    </div>
  );
}
