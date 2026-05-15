import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

/**
 * Hält den Live-Zähler ungesehener Eingänge (status='submitted',
 * gesehen_am IS NULL). Initial wird ein einzelner COUNT-Query
 * ausgeführt; danach hält eine Realtime-Subscription auf Inserts/
 * Updates der ausgefuellte_formulare-Tabelle den Wert aktuell.
 *
 * Nur für Admins aktiv — Fahrer interessiert das Badge nicht.
 */

interface EingaengeContextValue {
  /** Anzahl ungesehener Eingänge. */
  unseen: number;
  /** Wird ein animierter Pulse beim Badge gezeigt (nach neuem Eingang)? */
  pulse: boolean;
  /** Markiert alle ungesehenen Eingänge als gesehen. */
  markAllSeen: () => Promise<void>;
}

const EingaengeContext = createContext<EingaengeContextValue | undefined>(undefined);

export function EingaengeProvider({ children }: { children: ReactNode }) {
  const { profile, status: authStatus } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [unseen, setUnseen] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prevRef = useRef(0);
  const pulseTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) { setUnseen(0); return; }
    const { count, error } = await supabase
      .from('ausgefuellte_formulare')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .is('gesehen_am', null);
    if (error) {
      console.warn('[EingaengeContext] count failed', error);
      return;
    }
    const next = count ?? 0;
    if (next > prevRef.current) {
      // Neuer Eingang → kurze Pulse-Animation am Badge.
      setPulse(true);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setPulse(false), 1500);
    }
    prevRef.current = next;
    setUnseen(next);
  }, [isAdmin]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !isAdmin) return;
    void refresh();

    const channel = supabase
      .channel('eingaenge-notifications')
      .on(
        // Neuer Draft / Submission angelegt.
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ausgefuellte_formulare' },
        () => { void refresh(); },
      )
      .on(
        // Status → submitted oder gesehen_am gesetzt → Count ändert sich.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ausgefuellte_formulare' },
        () => { void refresh(); },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    };
  }, [authStatus, isAdmin, refresh]);

  const markAllSeen = useCallback(async () => {
    if (!isAdmin) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('ausgefuellte_formulare')
      .update({ gesehen_am: now })
      .eq('status', 'submitted')
      .is('gesehen_am', null);
    if (error) {
      console.warn('[EingaengeContext] markAllSeen failed', error);
      return;
    }
    prevRef.current = 0;
    setUnseen(0);
  }, [isAdmin]);

  const value = useMemo(
    () => ({ unseen, pulse, markAllSeen }),
    [unseen, pulse, markAllSeen],
  );

  return <EingaengeContext.Provider value={value}>{children}</EingaengeContext.Provider>;
}

export function useEingaengeNotifications(): EingaengeContextValue {
  const ctx = useContext(EingaengeContext);
  if (!ctx) throw new Error('useEingaengeNotifications muss innerhalb <EingaengeProvider> verwendet werden');
  return ctx;
}
