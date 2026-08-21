// Umschalter zwischen Rechnungen, Gutschriften, Briefen und Tankkarten.
//
// Bewusst KEIN neuer Hauptreiter — die Hauptnavigation ist voll. Alle
// Dokument-Übersichten teilen sich diese Leiste; Briefe und Tankkarten
// sind mit 091 dazugekommen.

import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/rechnungen',   label: 'Rechnungen' },
  { to: '/gutschriften', label: 'Gutschriften' },
  { to: '/briefe',       label: 'Briefe' },
  { to: '/tankkarten',   label: 'Tankkarten' },
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
