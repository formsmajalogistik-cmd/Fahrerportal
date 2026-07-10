import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';

/**
 * Dezenter Erinnerungs-Punkt für Fahrer am Profil-Menü: sichtbar,
 * solange eine OFFENE Führerscheinabfrage existiert, zu der das aktive
 * Konto noch NICHT eingereicht hat. Verschwindet nach der Einreichung
 * (Event `maja:fuehrerschein-changed` aus dem Popup) bzw. spätestens
 * beim nächsten Poll/Fokus-Refresh. Das Popup beim App-Öffnen bleibt —
 * der Punkt ist die Dauer-Erinnerung, falls es weggeklickt wurde.
 *
 * Nur für echte Fahrer-Konten; ausgenommene Konten (fs_ausgenommen)
 * und alle anderen Rollen sehen nie einen Punkt.
 */
export function FuehrerscheinReminderDot() {
  const { profile } = useAuth();
  const { activeFahrer } = useFahrerContext();
  const [offen, setOffen] = useState(false);

  const fahrerId = activeFahrer?.id ?? null;
  const ausgenommen = activeFahrer?.fs_ausgenommen ?? false;
  const isFahrer = profile?.role === 'fahrer';

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (!isFahrer || !fahrerId || ausgenommen) {
        if (!cancelled) setOffen(false);
        return;
      }
      try {
        const { data: open } = await supabase
          .from('fuehrerschein_abfragen')
          .select('id')
          .eq('status', 'offen')
          .order('gestartet_am', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (!open) { setOffen(false); return; }
        const { count } = await supabase
          .from('fuehrerschein_einreichungen')
          .select('id', { count: 'exact', head: true })
          .eq('abfrage_id', open.id)
          .eq('fahrer_id', fahrerId);
        if (cancelled) return;
        setOffen((count ?? 0) === 0);
      } catch (err) {
        console.warn('[FuehrerscheinReminderDot] Check fehlgeschlagen', err);
      }
    }
    const t = window.setTimeout(() => { void refresh(); }, 0);
    // Nach der Einreichung im Popup sofort aktualisieren; sonst
    // Polling (60 s) + Fokus-Refresh als Fallback.
    const onChanged = () => { void refresh(); };
    window.addEventListener('maja:fuehrerschein-changed', onChanged);
    const pollHandle = window.setInterval(() => { void refresh(); }, 60_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener('maja:fuehrerschein-changed', onChanged);
      window.clearInterval(pollHandle);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isFahrer, fahrerId, ausgenommen]);

  if (!offen) return null;
  return (
    <span
      aria-label="Führerscheinabfrage offen — bitte einreichen"
      title="Führerscheinabfrage offen — bitte einreichen"
      className="absolute -right-0.5 -top-0.5 z-10 inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-surface-800"
    />
  );
}
