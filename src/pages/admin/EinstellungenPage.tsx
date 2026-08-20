import { NavLink, Outlet } from 'react-router-dom';

interface SubNavItem { to: string; label: string }

const subNav: SubNavItem[] = [
  { to: '/einstellungen/auftraggeber', label: 'Auftraggeber' },
  { to: '/einstellungen/preislisten',  label: 'Preislisten' },
  { to: '/einstellungen/fahrer',       label: 'Fahrer' },
  { to: '/einstellungen/postfaecher',  label: 'E-Mail-Postfächer' },
  { to: '/einstellungen/vorschlaege',  label: 'Adressen / Vorschläge' },
  { to: '/einstellungen/gutschriften', label: 'Gutschriften' },
  { to: '/einstellungen/manuelle-empfaenger', label: 'Manuelle Empfänger' },
  { to: '/einstellungen/auftrags-email', label: 'Auftrags-E-Mail' },
];

export function EinstellungenPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Einstellungen</h1>
        <p className="text-sm text-maja-muted">
          Stammdaten verwalten: Auftraggeber, Preislisten und Fahrer.
        </p>
      </div>

      <nav className="border-b border-maja-navy/10">
        <ul className="flex flex-wrap gap-1">
          {subNav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  `inline-block rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'border-b-2 border-maja-navy bg-white text-maja-navy'
                      : 'text-maja-muted hover:bg-maja-light hover:text-maja-navy'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <Outlet />
      </div>
    </div>
  );
}
