import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import type { Fahrer } from '../types/db';

interface FahrerContextValue {
  /** Alle Fahrer-Einträge, die zum aktuellen Auth-User gehören
   *  (eigener Haupt-Eintrag + alle eigenen Unterkonten). */
  availableFahrer: Fahrer[];
  /** Aktuell ausgewähltes Konto. Null, wenn der User auswählen muss. */
  activeFahrer: Fahrer | null;
  /** True wenn der User mehrere Konten hat und noch keins gewählt ist. */
  needsPicker: boolean;
  /** Initialer Load läuft noch. */
  loading: boolean;
  /** Konto wechseln (oder null = zurück zur Auswahl). */
  setActive: (fahrerId: string | null) => void;
  /** Reload — z.B. nachdem ein Unterkonto angelegt/gelöscht wurde. */
  refresh: () => Promise<void>;
}

const FahrerContext = createContext<FahrerContextValue | undefined>(undefined);

function storageKey(userId: string): string {
  return `maja:active-fahrer:${userId}`;
}

export function FahrerProvider({ children }: { children: ReactNode }) {
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;

  const [availableFahrer, setAvailableFahrer] = useState<Fahrer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setAvailableFahrer([]);
      setActiveId(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('fahrer')
      .select('*')
      .eq('user_id', userId)
      .order('ist_unterkonto', { ascending: true })
      .order('nachname', { ascending: true });
    if (error) {
      console.warn('Konnte Fahrer-Liste nicht laden', error);
      setAvailableFahrer([]);
      setLoading(false);
      return;
    }
    const list = (data as Fahrer[]) ?? [];
    setAvailableFahrer(list);

    // Auto-Auswahl: bei genau einem Konto direkt nehmen.
    if (list.length === 1) {
      setActiveId(list[0].id);
      try { localStorage.setItem(storageKey(userId), list[0].id); } catch { /* noop */ }
    } else if (list.length > 1) {
      // Persistiertes Konto restaurieren — falls noch vorhanden.
      let stored: string | null = null;
      try { stored = localStorage.getItem(storageKey(userId)); } catch { /* noop */ }
      const found = stored ? list.find((f) => f.id === stored) : null;
      setActiveId(found ? found.id : null);
    } else {
      setActiveId(null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (status === 'authenticated') void load();
    else {
      setAvailableFahrer([]);
      setActiveId(null);
    }
  }, [status, load]);

  const setActive = useCallback((fahrerId: string | null) => {
    setActiveId(fahrerId);
    if (!userId) return;
    try {
      if (fahrerId) localStorage.setItem(storageKey(userId), fahrerId);
      else localStorage.removeItem(storageKey(userId));
    } catch { /* noop */ }
  }, [userId]);

  const activeFahrer = useMemo(
    () => availableFahrer.find((f) => f.id === activeId) ?? null,
    [availableFahrer, activeId],
  );

  const needsPicker = availableFahrer.length > 1 && !activeFahrer;

  const value = useMemo<FahrerContextValue>(() => ({
    availableFahrer,
    activeFahrer,
    needsPicker,
    loading,
    setActive,
    refresh: load,
  }), [availableFahrer, activeFahrer, needsPicker, loading, setActive, load]);

  return <FahrerContext.Provider value={value}>{children}</FahrerContext.Provider>;
}

export function useFahrerContext(): FahrerContextValue {
  const ctx = useContext(FahrerContext);
  if (!ctx) throw new Error('useFahrerContext muss innerhalb von <FahrerProvider> verwendet werden');
  return ctx;
}
