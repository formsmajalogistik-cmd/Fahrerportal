// Hinweis-Punkt am Navigationspunkt „Briefe" (Migration 091).
//
// Sichtbar, solange dem Fahrer mindestens ein zugestellter Brief
// vorliegt, den er noch nicht unterschrieben hat. Gleiche Mechanik wie
// der Führerschein-Punkt: sofortige Aktualisierung per Event, dazu
// Polling und Fokus-Refresh als Fallback.
//
// Welche Briefe der Fahrer überhaupt sieht, entscheidet die RLS — diese
// Komponente zählt nur, was ohnehin sichtbar ist.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

export function BriefeReminderDot() {
  const { profile } = useAuth();
  const [offen, setOffen] = useState(0);
  const istFahrer = profile?.role === 'fahrer';

  useEffect(() => {
    let abgebrochen = false;
    async function refresh() {
      if (!istFahrer) { if (!abgebrochen) setOffen(0); return; }
      try {
        const { count } = await supabase
          .from('briefe')
          .select('id', { count: 'exact', head: true })
          .is('unterschrieben_am', null);
        if (abgebrochen) return;
        setOffen(count ?? 0);
      } catch (err) {
        console.warn('[BriefeReminderDot] Check fehlgeschlagen', err);
      }
    }
    const t = window.setTimeout(() => { void refresh(); }, 0);
    const onChanged = () => { void refresh(); };
    window.addEventListener('maja:briefe-changed', onChanged);
    const poll = window.setInterval(() => { void refresh(); }, 60_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      abgebrochen = true;
      window.clearTimeout(t);
      window.removeEventListener('maja:briefe-changed', onChanged);
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [istFahrer]);

  if (offen === 0) return null;
  return (
    <span
      aria-label={`${offen} Brief(e) warten auf Ihre Unterschrift`}
      title={`${offen} Brief(e) warten auf Ihre Unterschrift`}
      className="absolute -right-1 -top-1 z-10 inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-surface-800"
    />
  );
}
