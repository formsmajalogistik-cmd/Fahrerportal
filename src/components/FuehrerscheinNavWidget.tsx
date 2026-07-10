import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Einstiegspunkt „Führerscheinabfrage" am unteren Rand der Admin-Sidebar.
 * Zeigt das Datum der letzten Abfrage; ist diese >= 3 Monate her, wird
 * das Datum gelb (nächste Abfrage fällig). Zusätzlich ein Notification-
 * Punkt (Stil wie der Eingänge-Blip), solange ungeprüfte Einreichungen
 * vorliegen — verschwindet, sobald alles geprüft/abgehakt ist.
 */
export function FuehrerscheinNavWidget() {
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ungeprueft, setUngeprueft] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => { void load(); }, 0);
    async function load() {
      try {
        const { data } = await supabase
          .from('fuehrerschein_abfragen')
          .select('gestartet_am')
          .order('gestartet_am', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setLastAt(data?.gestartet_am ?? null);
      } catch { /* still */ }
      finally { if (!cancelled) setLoaded(true); }
    }
    return () => { cancelled = true; window.clearTimeout(t); };
  }, []);

  // Blip: ungecachter head-COUNT auf ungeprüfte ECHTE Einreichungen
  // (manuell erledigte zählen nicht). Realtime + 30-s-Polling + Fokus-
  // Refresh — analog zum Eingänge-Blip in EingaengeContext.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const { count, error } = await supabase
        .from('fuehrerschein_einreichungen')
        .select('id', { count: 'exact', head: true })
        .eq('geprueft', false)
        .eq('manuell_erledigt', false);
      if (cancelled) return;
      if (error) { console.warn('[FuehrerscheinNavWidget] count failed', error); return; }
      setUngeprueft(count ?? 0);
    }
    const t = window.setTimeout(() => { void refresh(); }, 0);
    const channel = supabase
      .channel('fuehrerschein-notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fuehrerschein_einreichungen' },
        () => { void refresh(); },
      )
      .subscribe();
    const pollHandle = window.setInterval(() => { void refresh(); }, 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      void supabase.removeChannel(channel);
      window.clearInterval(pollHandle);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const faellig = (() => {
    if (!lastAt) return true; // noch nie → fällig
    const d = new Date(lastAt);
    if (Number.isNaN(d.getTime())) return false;
    const drei = new Date();
    drei.setMonth(drei.getMonth() - 3);
    return d.getTime() <= drei.getTime();
  })();

  const dateLabel = lastAt
    ? new Date(lastAt).toLocaleDateString('de-DE')
    : 'noch keine';

  return (
    <NavLink
      to="/fuehrerschein"
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-maja-navy text-white' : 'text-maja-ink hover:bg-maja-light'
        }`
      }
    >
      <span className="flex items-center gap-1.5">
        <KeyIcon className="h-4 w-4" />
        Führerscheinabfrage
        {ungeprueft > 0 && (
          <span
            aria-label={`${ungeprueft} ungeprüfte Einreichung(en)`}
            title={`${ungeprueft} ungeprüfte Einreichung(en)`}
            className="ml-1 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
          />
        )}
      </span>
      {loaded && (
        <span
          className={`mt-0.5 flex items-center gap-1 text-xs ${
            faellig ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-maja-muted'
          }`}
        >
          {faellig && <WarnIcon className="h-3 w-3 shrink-0" />}
          Letzte Abfrage: {dateLabel}
        </span>
      )}
    </NavLink>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}
