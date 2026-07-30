// Umschalter zwischen Rechnungen und Gutschriften.
//
// Bewusst KEIN neuer Hauptreiter — die Hauptnavigation ist voll. Beide
// Übersichten liegen unter /rechnungen bzw. /gutschriften und teilen
// sich diese Leiste.

import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/rechnungen',   label: 'Rechnungen' },
  { to: '/gutschriften', label: 'Gutschriften' },
];

export function RechnungenTabs() {
  return (
    <nav className="border-b border-maja-navy/10">
      <ul className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end
              className={({ isActive }) =>
                `inline-block rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border-b-2 border-maja-navy bg-white text-maja-navy'
                    : 'text-maja-muted hover:bg-maja-light hover:text-maja-navy'
                }`
              }
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
