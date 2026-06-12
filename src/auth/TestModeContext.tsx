import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/**
 * Test-Profile (role='test') sehen alle Daten read-only. Über diesen
 * Context steuert der eingeloggte Test-User, welche Rollen-Sicht im
 * Frontend simuliert werden soll (Fahrer oder Auftraggeber) und für
 * welchen Auftraggeber die Kunden-Sicht gerendert wird.
 *
 * Für Nicht-Test-Nutzer ist `isTestUser=false` und der Switcher wird
 * nicht angezeigt; die Hooks geben Defaults zurück.
 */

type EffectiveRole = 'fahrer' | 'auftraggeber';

const STORAGE_ROLE = 'maja:test-mode:effective-role';
const STORAGE_AG   = 'maja:test-mode:auftraggeber-id';

interface TestModeValue {
  /** True, wenn der eingeloggte User die Rolle 'test' hat. */
  isTestUser: boolean;
  /** Simulierte Rolle (Fahrer oder Auftraggeber). Für Nicht-Test-User
   *  ist sie undefined / wird nicht verwendet. */
  effectiveRole: EffectiveRole;
  effectiveAuftraggeberId: string | null;
  /** Liste aller Auftraggeber für das Dropdown im Banner. */
  auftraggeberOptions: Array<{ id: string; name: string }>;
  setEffectiveRole: (r: EffectiveRole) => void;
  setEffectiveAuftraggeberId: (id: string | null) => void;
  /** Kurzes Test-Mode-Toast einblenden (zentriert unten). */
  showTestToast: (text?: string) => void;
  /** Read der aktuellen Toast-Message (für Provider-internes Rendern). */
  toast: string | null;
}

const TestModeContext = createContext<TestModeValue | undefined>(undefined);

export function TestModeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const isTestUser = profile?.role === 'test';

  const [effectiveRole, setEffectiveRoleState] = useState<EffectiveRole>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_ROLE);
      if (stored === 'auftraggeber' || stored === 'fahrer') return stored;
    } catch { /* noop */ }
    return 'fahrer';
  });

  const [effectiveAuftraggeberId, setEffectiveAuftraggeberIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_AG); } catch { return null; }
  });

  const [auftraggeberOptions, setAuftraggeberOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Auftraggeber-Liste nur für Test-User laden. RLS lässt Test-User
  // alle Auftraggeber lesen (siehe Migration 059).
  useEffect(() => {
    if (!isTestUser) {
      // Asynchron, damit der Reset nicht synchron im Effect läuft
      // (react-hooks/set-state-in-effect).
      queueMicrotask(() => setAuftraggeberOptions([]));
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from('auftraggeber').select('id, name').order('name');
      if (cancelled) return;
      const list = (data as Array<{ id: string; name: string }>) ?? [];
      setAuftraggeberOptions(list);
      // Wenn noch keiner gewählt ist und die Liste nicht leer, ersten
      // setzen — sonst zeigt die Auftraggeber-Sicht keine Touren.
      setEffectiveAuftraggeberIdState((cur) => cur ?? list[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [isTestUser]);

  const setEffectiveRole = useCallback((r: EffectiveRole) => {
    setEffectiveRoleState(r);
    try { localStorage.setItem(STORAGE_ROLE, r); } catch { /* noop */ }
  }, []);

  const setEffectiveAuftraggeberId = useCallback((id: string | null) => {
    setEffectiveAuftraggeberIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_AG, id);
      else localStorage.removeItem(STORAGE_AG);
    } catch { /* noop */ }
  }, []);

  const showTestToast = useCallback((text?: string) => {
    setToast(text ?? 'Testmodus — Änderungen werden nicht gespeichert.');
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const value = useMemo<TestModeValue>(() => ({
    isTestUser,
    effectiveRole,
    effectiveAuftraggeberId,
    auftraggeberOptions,
    setEffectiveRole,
    setEffectiveAuftraggeberId,
    showTestToast,
    toast,
  }), [
    isTestUser, effectiveRole, effectiveAuftraggeberId, auftraggeberOptions,
    setEffectiveRole, setEffectiveAuftraggeberId, showTestToast, toast,
  ]);

  return (
    <TestModeContext.Provider value={value}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </TestModeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTestMode(): TestModeValue {
  const ctx = useContext(TestModeContext);
  if (!ctx) {
    // Kein Provider → Defaults, damit das ohne Provider-Setup nicht crasht.
    return {
      isTestUser: false,
      effectiveRole: 'fahrer',
      effectiveAuftraggeberId: null,
      auftraggeberOptions: [],
      setEffectiveRole: () => { /* noop */ },
      setEffectiveAuftraggeberId: () => { /* noop */ },
      showTestToast: () => { /* noop */ },
      toast: null,
    };
  }
  return ctx;
}

/**
 * Guard für Schreibaktionen. Aufrufen am Anfang jedes Save/Delete/Send/
 * Upload-Handlers. Liefert true zurück, wenn die Aktion blockiert wurde
 * (dann SOFORT `return` im Handler). Zeigt einen Toast für Test-User;
 * für alle anderen passiert nichts.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTestGuard() {
  const { isTestUser, showTestToast } = useTestMode();
  return useCallback((label?: string) => {
    if (!isTestUser) return false;
    showTestToast(label);
    return true;
  }, [isTestUser, showTestToast]);
}
