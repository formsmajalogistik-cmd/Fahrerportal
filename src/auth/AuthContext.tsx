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
  /** True, solange für eine bestehende Session das Profil (mit Rolle)
   *  erstmalig geladen wird. UI muss dann einen Ladebildschirm zeigen,
   *  NICHT voreilig eine Default-Ansicht. */
  profileLoading: boolean;
  /** True, wenn eine Session existiert, das Profil aber (nach Retries)
   *  nicht geladen werden konnte oder gar nicht existiert. UI zeigt dann
   *  eine Fehlerseite mit Logout — niemals die Fahrer-Default-Ansicht. */
  profileError: boolean;
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
// Timeout pro Profil-Load-Versuch. Bei Fehlschlag wird mit Backoff erneut
// versucht (siehe loadProfileWithRetry).
const PROFILE_TIMEOUT_MS = 4000;
const PROFILE_RETRIES = 3;

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

/**
 * Lädt das app_users-Profil robust: bis zu PROFILE_RETRIES Versuche mit
 * Backoff bei Netzwerk-/Timeout-Fehlern.
 *
 * Rückgabe:
 *   - { profile, ok: true }      → erfolgreich geladen (profile kann null
 *                                  sein, wenn kein app_users-Datensatz
 *                                  existiert — echtes Konto-Problem).
 *   - { profile: null, ok: false } → DB nach allen Versuchen nicht
 *                                  erreichbar (Netzwerk/Timing).
 */
async function loadProfileWithRetry(
  userId: string,
): Promise<{ profile: AppUser | null; ok: boolean }> {
  for (let attempt = 0; attempt < PROFILE_RETRIES; attempt += 1) {
    try {
      const { data, error } = await withTimeout(
        supabase.from('app_users').select('*').eq('id', userId).maybeSingle(),
        PROFILE_TIMEOUT_MS,
        'loadProfile',
      );
      if (!error) {
        // DB erreichbar — data kann null sein (kein Datensatz).
        return { profile: (data as AppUser | null) ?? null, ok: true };
      }
      console.warn(`[Auth] Profil-Load Fehler (Versuch ${attempt + 1}/${PROFILE_RETRIES})`, error.message);
    } catch (err) {
      console.warn(`[Auth] Profil-Load Timeout (Versuch ${attempt + 1}/${PROFILE_RETRIES})`, err);
    }
    if (attempt < PROFILE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return { profile: null, ok: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const initializedRef = useRef(false);
  // Spiegelt das aktuelle Profil — damit apply() bei Hintergrund-Reloads
  // (TOKEN_REFRESHED) erkennt, ob bereits ein Profil für diesen User da
  // ist (dann KEIN Ladebildschirm) und einen kurzzeitigen Netz-Blip nicht
  // in eine Fehlerseite umschlagen lässt.
  const profileRef = useRef<AppUser | null>(null);

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
      setProfileError(false);
      setProfileLoading(false);
      setStatus('unauthenticated');
    }, SESSION_TIMEOUT_MS);

    async function apply(s: Session | null) {
      if (cancelled) return;
      initializedRef.current = true;
      window.clearTimeout(timeoutId);
      setSession(s);
      if (!s) {
        profileRef.current = null;
        setProfile(null);
        setProfileError(false);
        setProfileLoading(false);
        setStatus('unauthenticated');
        return;
      }
      // Session steht fest. Rolle MUSS geladen sein, bevor die App eine
      // rollenabhängige Ansicht zeigt — daher profileLoading, solange wir
      // noch kein Profil für genau diesen User haben.
      setStatus('authenticated');
      const sameUser = profileRef.current?.id === s.user.id;
      if (!sameUser) {
        setProfileLoading(true);
        setProfileError(false);
      }
      const { profile: p, ok } = await loadProfileWithRetry(s.user.id);
      if (cancelled) return;
      if (p) {
        profileRef.current = p;
        setProfile(p);
        setProfileError(false);
      } else if (!profileRef.current) {
        // Erst-Load fehlgeschlagen / kein Datensatz → Fehlerzustand
        // (NICHT auf Fahrer defaulten). ok=false = Netzproblem,
        // ok=true+null = kein app_users-Eintrag.
        setProfile(null);
        setProfileError(true);
        console.warn('[Auth] Kein Profil ladbar', { ok });
      }
      // else: Hintergrund-Reload-Blip bei vorhandenem Profil → altes
      // Profil behalten, kein Fehler.
      setProfileLoading(false);
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

    // PWA-Resume-Handling: iOS-/macOS-Safari pausiert Background-Timer
    // aggressiv, sodass autoRefreshToken nicht ausgelöst wird. Wenn die
    // App wieder sichtbar wird, prüfen wir die Session und refreshen,
    // falls sie abgelaufen ist — sonst landet der erste API-Call nach
    // dem App-Wechsel in einem 401.
    async function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('[Auth/visibility] getSession-Fehler', error.message);
          return;
        }
        const s = data.session;
        if (!s) return; // Kein User eingeloggt → nichts zu tun.
        const expiresAt = s.expires_at ?? 0;
        const now = Math.floor(Date.now() / 1000);
        if (expiresAt - now < 120) {
          console.info('[Auth/visibility] Session läuft bald ab — refresh');
          const r = await supabase.auth.refreshSession();
          if (r.error || !r.data.session) {
            console.warn('[Auth/visibility] Refresh fehlgeschlagen, signOut');
            await supabase.auth.signOut().catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[Auth/visibility] Fehler', err);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      profileLoading,
      profileError,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        // Aktives Unterkonto pro User entfernen, damit beim nächsten Login
        // wieder der Konto-Picker erscheint (falls mehrere vorhanden).
        try {
          const uid = session?.user.id;
          if (uid) localStorage.removeItem(`maja:active-fahrer:${uid}`);
        } catch { /* noop */ }
        profileRef.current = null;
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
      // Erneuter Profil-Load — genutzt nach Rollen-Änderung und vom
      // Fehlerschirm-„Erneut versuchen". Setzt profileLoading nur, wenn
      // noch kein Profil vorhanden ist (sonst Hintergrund-Refresh).
      refreshProfile: async () => {
        if (!session) return;
        if (!profileRef.current) { setProfileLoading(true); setProfileError(false); }
        const { profile: p } = await loadProfileWithRetry(session.user.id);
        if (p) {
          profileRef.current = p;
          setProfile(p);
          setProfileError(false);
        } else if (!profileRef.current) {
          setProfile(null);
          setProfileError(true);
        }
        setProfileLoading(false);
      },
    }),
    [status, session, profile, profileLoading, profileError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return ctx;
}
