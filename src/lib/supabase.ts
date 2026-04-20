import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/db';

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
  },
});
