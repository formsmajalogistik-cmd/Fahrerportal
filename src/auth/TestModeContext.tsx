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
const STORAGE_FA   = 'maja:test-mode:fahrer-id';

interface FahrerOption {
  id: string;
  /** Anzeige-Name fürs Dropdown (vorname + nachname / Mail-Fallback). */
  label: string;
  /** Haupt-Konto-User-Id, falls Unterkonto — wird genutzt, um beim
   *  Filtern Touren/Eingänge des Haupt-Kontos UND aller Unterkonten
   *  desselben Haupt-Users zu zeigen. */
  user_id: string;
  ist_unterkonto: boolean;
  haupt_user_id: string | null;
}

interface TestModeValue {
  /** True, wenn der eingeloggte User die Rolle 'test' hat. */
  isTestUser: boolean;
  /** Simulierte Rolle (Fahrer oder Auftraggeber). Für Nicht-Test-User
   *  ist sie undefined / wird nicht verwendet. */
  effectiveRole: EffectiveRole;
  effectiveAuftraggeberId: string | null;
  /** Liste aller Auftraggeber für das Dropdown im Banner. */
  auftraggeberOptions: Array<{ id: string; name: string }>;
  /** Simulierte Fahrer-Identität für die Fahrer-Sicht im Testmodus. */
  effectiveFahrerId: string | null;
  /** Liste aller aktiven Fahrer (für das Banner-Dropdown). */
  fahrerOptions: FahrerOption[];
  /** Welche fahrer.id-Werte gelten als „gehört zum simulierten Fahrer"
   *  (= der gewählte Fahrer selbst + alle Unterkonten desselben Haupt-
   *  Kontos). Im Nicht-Test-Modus oder ohne Auswahl leeres Array. */
  scopedFahrerIds: string[];
  setEffectiveRole: (r: EffectiveRole) => void;
  setEffectiveAuftraggeberId: (id: string | null) => void;
  setEffectiveFahrerId: (id: string | null) => void;
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

  const [effectiveFahrerId, setEffectiveFahrerIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_FA); } catch { return null; }
  });

  const [auftraggeberOptions, setAuftraggeberOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [fahrerOptions, setFahrerOptions] = useState<FahrerOption[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Auftraggeber- + Fahrer-Liste nur für Test-User laden. RLS lässt
  // Test-User alle Stammdaten lesen (siehe Migration 059).
  useEffect(() => {
    if (!isTestUser) {
      // Asynchron, damit der Reset nicht synchron im Effect läuft
      // (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        setAuftraggeberOptions([]);
        setFahrerOptions([]);
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      const [agRes, faRes] = await Promise.all([
        supabase.from('auftraggeber').select('id, name').order('name'),
        supabase
          .from('fahrer')
          .select('id, user_id, ist_unterkonto, haupt_user_id, vorname, nachname, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
      ]);
      if (cancelled) return;
      const agList = (agRes.data as Array<{ id: string; name: string }>) ?? [];
      setAuftraggeberOptions(agList);
      // Wenn noch keiner gewählt ist und die Liste nicht leer, ersten
      // setzen — sonst zeigt die Auftraggeber-Sicht keine Touren.
      setEffectiveAuftraggeberIdState((cur) => cur ?? agList[0]?.id ?? null);

      type RawFahrer = {
        id: string; user_id: string;
        ist_unterkonto: boolean | null; haupt_user_id: string | null;
        vorname: string | null; nachname: string | null;
        user: { email: string | null; vorname: string | null; nachname: string | null } | null;
      };
      const raw = (faRes.data as unknown as RawFahrer[]) ?? [];
      const faList: FahrerOption[] = raw.map((f) => {
        const vor = (f.vorname ?? f.user?.vorname ?? '').trim();
        const nach = (f.nachname ?? f.user?.nachname ?? '').trim();
        const name = `${vor} ${nach}`.trim();
        const label = name !== ''
          ? `${name}${f.ist_unterkonto ? ' (Unterkonto)' : ''}`
          : (f.user?.email ?? f.id.slice(0, 8));
        return {
          id: f.id, user_id: f.user_id,
          ist_unterkonto: !!f.ist_unterkonto,
          haupt_user_id: f.haupt_user_id,
          label,
        };
      }).sort((a, b) => a.label.localeCompare(b.label, 'de'));
      setFahrerOptions(faList);
      // Default: ersten Fahrer (bevorzugt Haupt-Konto) wählen, damit
      // die Tourenliste im Testmodus nicht leer bleibt.
      setEffectiveFahrerIdState((cur) => {
        if (cur && faList.some((f) => f.id === cur)) return cur;
        const firstHaupt = faList.find((f) => !f.ist_unterkonto);
        return cur ?? firstHaupt?.id ?? faList[0]?.id ?? null;
      });
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

  const setEffectiveFahrerId = useCallback((id: string | null) => {
    setEffectiveFahrerIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_FA, id);
      else localStorage.removeItem(STORAGE_FA);
    } catch { /* noop */ }
  }, []);

  // Scope-Auflösung: der simulierte Fahrer SIEHT die eigenen Touren
  // plus die seiner Unterkonten (wenn er Haupt-Konto ist). Bei Auswahl
  // eines Unterkontos nur dessen Daten — analog zur echten Logik in
  // TourenlistePage.scopedFahrerIds.
  const scopedFahrerIds = useMemo<string[]>(() => {
    if (!isTestUser || !effectiveFahrerId) return [];
    const me = fahrerOptions.find((f) => f.id === effectiveFahrerId);
    if (!me) return [effectiveFahrerId];
    if (me.ist_unterkonto) return [me.id];
    const subs = fahrerOptions
      .filter((f) => f.ist_unterkonto && f.haupt_user_id === me.user_id)
      .map((f) => f.id);
    return [me.id, ...subs];
  }, [isTestUser, effectiveFahrerId, fahrerOptions]);

  const showTestToast = useCallback((text?: string) => {
    setToast(text ?? 'Testmodus — Änderungen werden nicht gespeichert.');
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const value = useMemo<TestModeValue>(() => ({
    isTestUser,
    effectiveRole,
    effectiveAuftraggeberId,
    auftraggeberOptions,
    effectiveFahrerId,
    fahrerOptions,
    scopedFahrerIds,
    setEffectiveRole,
    setEffectiveAuftraggeberId,
    setEffectiveFahrerId,
    showTestToast,
    toast,
  }), [
    isTestUser, effectiveRole, effectiveAuftraggeberId, auftraggeberOptions,
    effectiveFahrerId, fahrerOptions, scopedFahrerIds,
    setEffectiveRole, setEffectiveAuftraggeberId, setEffectiveFahrerId,
    showTestToast, toast,
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
      effectiveFahrerId: null,
      fahrerOptions: [],
      scopedFahrerIds: [],
      setEffectiveRole: () => { /* noop */ },
      setEffectiveAuftraggeberId: () => { /* noop */ },
      setEffectiveFahrerId: () => { /* noop */ },
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
