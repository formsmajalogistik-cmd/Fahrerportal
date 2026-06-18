import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MajaLogo } from './Brand';
import { ProfilMenu } from './ProfilMenu';
import { OfflineBanner } from './OfflineBanner';
import { PdfPreviewProvider } from './PdfPreviewProvider';
import { useEingaengeNotifications } from '../sync/EingaengeContext';
import { FuehrerscheinNavWidget } from './FuehrerscheinNavWidget';
import { supabase } from '../lib/supabase';

interface NavItem { to: string; label: string; end?: boolean }

/** Schlichter Punkt statt Zahlen-Badge — zeigt nur AN/AUS. */
function NavBadge({ count, pulse, label }: { count: number; pulse?: boolean; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      className={`ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500 ${
        pulse ? 'animate-ping' : ''
      }`}
    />
  );
}

/**
 * Leichtgewichtige Zähler für die Nav-Punkte: unbestätigte Touren
 * (Auftraggeber-Einreichungen → Tourenliste) und offene Formular-
 * Wünsche (→ Templates). 60s-Polling + Refresh bei Fokus; Fehler
 * (z.B. Migration noch nicht eingespielt) werden still geschluckt.
 */
function useAdminPendingCounts(): { unbestaetigt: number; wuensche: number } {
  const [counts, setCounts] = useState({ unbestaetigt: 0, wuensche: 0 });
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [t, w] = await Promise.all([
          supabase.from('touren')
            .select('id', { count: 'exact', head: true })
            .eq('bestaetigt', false),
          supabase.from('formular_wuensche')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'offen'),
        ]);
        if (cancelled) return;
        setCounts({
          unbestaetigt: t.error ? 0 : (t.count ?? 0),
          wuensche: w.error ? 0 : (w.count ?? 0),
        });
      } catch { /* still — Badge bleibt einfach aus */ }
    }
    const t = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => { void refresh(); }, 60_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return counts;
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
  const { unbestaetigt, wuensche } = useAdminPendingCounts();

  function badgeFor(to: string) {
    if (to === '/eingaenge') return <NavBadge count={unseen} pulse={pulse} label="ungesehene Eingänge" />;
    if (to === '/touren') return <NavBadge count={unbestaetigt} label="unbestätigte Touren" />;
    if (to === '/templates') return <NavBadge count={wuensche} label="offene Formular-Wünsche" />;
    return null;
  }

  return (
    <div className="min-h-screen bg-maja-light">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-maja-navy/10 bg-white lg:flex">
        <div className="px-5 py-5 border-b border-maja-navy/10">
          <MajaLogo className="h-9" />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
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
                  {badgeFor(item.to)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {/* Führerscheinabfrage unten links, mit Datum + Fällig-Indikator. */}
        <div className="border-t border-maja-navy/10 px-3 py-3">
          <FuehrerscheinNavWidget />
        </div>
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
                    {badgeFor(item.to)}
                  </NavLink>
                </li>
              ))}
              <li>
                <NavLink
                  to="/fuehrerschein"
                  className={({ isActive }) =>
                    `inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-maja-navy text-white'
                        : 'text-maja-navy hover:bg-maja-light'
                    }`
                  }
                >
                  Führerschein
                </NavLink>
              </li>
            </ul>
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
      <PdfPreviewProvider />
    </div>
  );
}
