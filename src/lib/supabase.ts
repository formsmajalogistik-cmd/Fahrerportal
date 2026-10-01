import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';
import { fetchWithRetry } from './fetchRetry';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Supabase-Umgebungsvariablen fehlen. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in .env setzen.',
  );
}

const STORAGE_KEY = 'maja-logistik-auth';

export const supabase = createClient<Database>(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Eindeutiger storageKey + expliziter localStorage. supabase-js v2
    // nutzt zwar standardmäßig localStorage, aber wenn z.B. ein anderes
    // Supabase-Projekt (oder eine ältere App-Version) dieselben
    // Default-Keys belegt hat, kommt es in Safari/PWA zu kuriosen
    // "Token ungültig"-401ern, weil ein fremder Token ausgepackt wird.
    storageKey: STORAGE_KEY,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    // PKCE-Flow: in Safari/PWA robuster, weil er nicht auf URL-Fragment
    // ankommt, das beim Re-Open der PWA verloren gehen kann.
    flowType: 'pkce',
  },
  global: {
    // iOS-Hardening: Timeout (15 s) + bis zu 2 Retries für alle Supabase-Calls.
    fetch: (input, init) => fetchWithRetry(
      input as RequestInfo, init as Parameters<typeof fetchWithRetry>[1],
    ),
  },
});

/**
 * Liefert einen GARANTIERT gültigen Supabase-Access-Token zurück. Wenn
 * die gespeicherte Session in den nächsten 60 Sekunden abläuft (oder
 * schon abgelaufen ist), wird vor der Rückgabe `refreshSession()`
 * angestoßen. Schlägt der Refresh fehl, wird die Session aufgeräumt
 * und null zurückgegeben — der Aufrufer muss dann den 401-Pfad / die
 * Login-Umleitung verarbeiten. Ausnahme: scheitert der Refresh nur an
 * der Verbindung, bleibt die Session bestehen (siehe getValidTokenLage).
 *
 * Wird von allen API-Calls genutzt, die einen Bearer-Token brauchen
 * (OneDrive-Upload/-Download/-Delete, E-Mail-Versand). Verhindert, dass
 * Safari-PWA-Sessions stillschweigend mit einem abgelaufenen Token
 * weiterlaufen, weil iOS Background-Timer aggressiv pausiert und
 * autoRefreshToken im Hintergrund verschluckt.
 */
const REFRESH_BUFFER_SECONDS = 60;

/**
 * Wie getValidToken, sagt aber zusätzlich, WARUM kein Token da ist:
 *
 *   * 'keine_session' — die Anmeldung ist wirklich weg (Refresh-Token
 *     ungültig o.ä.). Dann wie bisher aufräumen; der Aufrufer leitet zum
 *     Login.
 *   * 'netz' — der Refresh scheiterte nur an der Verbindung. Dann NICHT
 *     abmelden: Vorher führte ein Funkloch kurz vor Ablauf des Tokens zur
 *     Abmeldung, und der nächste Foto-Upload warf den Fahrer mitten im
 *     Formular auf die Login-Seite — Foto und ungesicherte Eingaben weg.
 *     Ist das alte Token noch nicht abgelaufen, wird es weiter benutzt.
 */
export async function getValidTokenLage(): Promise<{
  token: string | null; grund: 'ok' | 'keine_session' | 'netz';
}> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    // getSession erneuert ein bald ablaufendes Token selbst (90 s vorher).
    // Scheitert das nur am Netz, behält supabase-js die gespeicherte
    // Session — dann ihr Token nehmen, solange es noch gilt.
    if (isAuthRetryableFetchError(error)) {
      console.warn('[supabase.getValidToken] Erneuerung ohne Verbindung — Session bleibt', error.message);
      return { token: gespeichertesGueltigesToken(), grund: 'netz' };
    }
    console.warn('[supabase.getValidToken] getSession-Fehler', error.message);
    return { token: null, grund: 'keine_session' };
  }
  if (!session) return { token: null, grund: 'keine_session' };

  const expiresAt = session.expires_at ?? 0;
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt - now > REFRESH_BUFFER_SECONDS) {
    return { token: session.access_token, grund: 'ok' };
  }
  // Token läuft bald ab oder ist schon weg → frischen versuchen.
  console.info('[supabase.getValidToken] Token läuft ab — refresh');
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    const nurNetz = (refreshErr && isAuthRetryableFetchError(refreshErr))
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (nurNetz) {
      console.warn('[supabase.getValidToken] Refresh ohne Verbindung — Session bleibt', refreshErr?.message);
      return { token: expiresAt > now ? session.access_token : null, grund: 'netz' };
    }
    console.warn('[supabase.getValidToken] Refresh fehlgeschlagen', refreshErr?.message);
    // Lokale Session ist tot — komplett aufräumen, damit AuthContext
    // den User per onAuthStateChange auf den Login schickt.
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    return { token: null, grund: 'keine_session' };
  }
  return { token: refreshed.session.access_token, grund: 'ok' };
}

export async function getValidToken(): Promise<string | null> {
  return (await getValidTokenLage()).token;
}

/** Access-Token aus dem Gerätespeicher, wenn es noch nicht abgelaufen ist. */
function gespeichertesGueltigesToken(): string | null {
  try {
    const roh = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    const s = roh ? JSON.parse(roh) as { access_token?: string; expires_at?: number } : null;
    if (!s?.access_token || !s.expires_at) return null;
    return s.expires_at > Math.floor(Date.now() / 1000) ? s.access_token : null;
  } catch {
    return null;
  }
}
