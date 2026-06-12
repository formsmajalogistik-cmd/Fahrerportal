import { createClient } from '@supabase/supabase-js';

interface AuthedUser {
  id: string;
  email: string;
  role: 'admin' | 'fahrer' | 'auftraggeber' | 'test' | null;
}

/**
 * Verifiziert den im Authorization-Header übergebenen Supabase-JWT und
 * lädt die Rolle aus app_users. Wirft, wenn der Token fehlt oder ungültig ist.
 *
 * Wichtig: für die Rollen-Abfrage wird der Token auch als
 * Authorization-Header auf den Supabase-Client gesetzt — die
 * app_users-RLS-Policy (`id = auth.uid() OR is_admin()`) hängt
 * davon ab. Ohne diesen Schritt würde der SELECT als Anon laufen,
 * keine Zeile zurückbekommen und der User würde fälschlich als
 * "kein Admin" eingestuft.
 */
export async function getAuthedUser(authHeader: string | null | undefined): Promise<AuthedUser> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Kein Authorization-Bearer-Token im Request');
  }
  const token = authHeader.slice(7).trim();
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');

  // Anon-Client zum Verifizieren des Tokens (auth.getUser kann nur
  // gegen den anon-Endpoint laufen).
  const verifier = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data?.user) {
    // Diagnose: in Safari/PWA kommt es vor, dass abgelaufene Tokens
    // rauskommen. Wir loggen Token-Länge + ersten 20 Zeichen, NICHT
    // den ganzen Token (Security).
    const preview = token.length > 20 ? `${token.slice(0, 20)}...` : token;
    console.warn('[getAuthedUser] auth.getUser fehlgeschlagen', {
      tokenLen: token.length, preview,
      errMsg: error?.message ?? 'no user',
    });
    throw new HttpError(401, 'Token ungültig');
  }

  // JWT-aware Client für die Rollen-Abfrage — RLS sieht damit auth.uid()
  // und lässt die self-read-Policy auf app_users durch.
  const authed = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: profile, error: profileErr } = await authed
    .from('app_users')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileErr) {
    console.warn('[getAuthedUser] role-Lookup fehlgeschlagen', profileErr.message);
  }

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    role: (profile?.role as AuthedUser['role']) ?? null,
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
