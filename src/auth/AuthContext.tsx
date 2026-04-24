import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AppUser } from '../types/db';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: Status;
  session: Session | null;
  profile: AppUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Maximalzeit für den initialen Session-Check. Wenn Supabase in dieser Zeit
// nicht antwortet (schlechtes Netz, kaputter Local-Storage), schalten wir auf
// unauthenticated — sonst hängt die App für immer auf „Sitzung wird geprüft …".
const SESSION_TIMEOUT_MS = 5000;
// Kürzeres Timeout für den Profil-Load: das Profil darf fehlen, ohne dass der
// Login-Flow blockiert.
const PROFILE_TIMEOUT_MS = 4000;

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout: ${label} (${ms} ms)`)),
      ms,
    );
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function loadProfile(userId: string): Promise<AppUser | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.from('app_users').select('*').eq('id', userId).maybeSingle(),
      PROFILE_TIMEOUT_MS,
      'loadProfile',
    );
    if (error) {
      console.warn('Profil konnte nicht geladen werden', error);
      return null;
    }
    return (data as AppUser | null) ?? null;
  } catch (err) {
    console.warn('loadProfile fehlgeschlagen', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Safety-Timeout: falls weder getSession noch onAuthStateChange innerhalb
    // SESSION_TIMEOUT_MS einen definitiven Zustand liefern, gehe auf
    // unauthenticated — der User kann sich dann neu einloggen, statt endlos
    // auf „Sitzung wird geprüft …" zu starren.
    const timeoutId = window.setTimeout(() => {
      if (cancelled || initializedRef.current) return;
      console.warn('Auth-Init-Timeout — schalte auf unauthenticated');
      initializedRef.current = true;
      setSession(null);
      setProfile(null);
      setStatus('unauthenticated');
    }, SESSION_TIMEOUT_MS);

    async function apply(s: Session | null) {
      if (cancelled) return;
      initializedRef.current = true;
      window.clearTimeout(timeoutId);
      setSession(s);
      if (!s) {
        setProfile(null);
        setStatus('unauthenticated');
        return;
      }
      const p = await loadProfile(s.user.id);
      if (cancelled) return;
      setProfile(p);
      setStatus('authenticated');
    }

    // Initialer Session-Check, mit hartem Timeout.
    (async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_TIMEOUT_MS,
          'getSession',
        );
        if (error) {
          // Typischer Fall: abgelaufener/ungültiger Refresh-Token. Wir räumen
          // die lokale Session auf und senden den User zum Login.
          console.warn('getSession-Error, räume Session auf', error);
          await supabase.auth.signOut().catch(() => {});
          void apply(null);
          return;
        }
        void apply(data.session ?? null);
      } catch (err) {
        console.warn('getSession timeout/fehler', err);
        // Falls onAuthStateChange schon gefeuert hat, ist das egal — sonst
        // rettet uns der Safety-Timeout oben.
        if (!initializedRef.current) void apply(null);
      }
    })();

    // Reagiere auf alle späteren Änderungen: Login, Logout, Token-Refresh,
    // Password-Reset-Link-Click.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return;
      // Token-Refresh, der ohne Session endet → lokale Session ist tot
      if (event === 'TOKEN_REFRESHED' && !s) {
        void supabase.auth.signOut().catch(() => {});
        void apply(null);
        return;
      }
      if (event === 'SIGNED_OUT') {
        void apply(null);
        return;
      }
      void apply(s);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      requestPasswordReset: async (email) => {
        const redirectTo = `${window.location.origin}/passwort-neu`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
      },
      updatePassword: async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
      refreshProfile: async () => {
        if (session) setProfile(await loadProfile(session.user.id));
      },
    }),
    [status, session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return ctx;
}
