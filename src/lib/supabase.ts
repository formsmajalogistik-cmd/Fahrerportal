import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';
import { fetchWithRetry } from './fetchRetry';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Supabase-Umgebungsvariablen fehlen. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in .env setzen.',
  );
}

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
    storageKey: 'maja-logistik-auth',
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
 * Login-Umleitung verarbeiten.
 *
 * Wird von allen API-Calls genutzt, die einen Bearer-Token brauchen
 * (OneDrive-Upload/-Download/-Delete, E-Mail-Versand). Verhindert, dass
 * Safari-PWA-Sessions stillschweigend mit einem abgelaufenen Token
 * weiterlaufen, weil iOS Background-Timer aggressiv pausiert und
 * autoRefreshToken im Hintergrund verschluckt.
 */
const REFRESH_BUFFER_SECONDS = 60;

export async function getValidToken(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('[supabase.getValidToken] getSession-Fehler', error.message);
    return null;
  }
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt - now > REFRESH_BUFFER_SECONDS) {
    return session.access_token;
  }
  // Token läuft bald ab oder ist schon weg → frischen versuchen.
  console.info('[supabase.getValidToken] Token läuft ab — refresh');
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    console.warn('[supabase.getValidToken] Refresh fehlgeschlagen', refreshErr?.message);
    // Lokale Session ist tot — komplett aufräumen, damit AuthContext
    // den User per onAuthStateChange auf den Login schickt.
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    return null;
  }
  return refreshed.session.access_token;
}
