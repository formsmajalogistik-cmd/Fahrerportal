import { createClient } from '@supabase/supabase-js';

interface AuthedUser {
  id: string;
  email: string;
  role: 'admin' | 'fahrer' | null;
}

/**
 * Verifiziert den im Authorization-Header übergebenen Supabase-JWT und
 * lädt die Rolle aus app_users. Wirft, wenn der Token fehlt oder ungültig ist.
 */
export async function getAuthedUser(authHeader: string | null | undefined): Promise<AuthedUser> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Kein Authorization-Bearer-Token im Request');
  }
  const token = authHeader.slice(7).trim();
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Token ungültig');

  const { data: profile } = await supa
    .from('app_users')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

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
