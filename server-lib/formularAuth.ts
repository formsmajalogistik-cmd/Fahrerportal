// Pro-Resource-Authorization für /api/download und /api/delete-pdf.
//
// Der Client schickt formular_id + path. Auf dem Server:
//   1) Wir laden die Zeile MIT dem JWT des Users — RLS entscheidet,
//      ob er sie sehen darf. Findet der SELECT die Zeile, ist der
//      User berechtigt; sonst 404.
//   2) Pfad-Sanity: wir akzeptieren jeden Pfad unter dem Maja-Wurzel-
//      Ordner ODER den exakten zwischenprotokoll_url-Eintrag. Strenge
//      Folder-Name-Checks (Datum/Kennzeichen/Template-Name) sind
//      brüchig, sobald sich Stammdaten (z.B. Template-Name) nach der
//      PDF-Erzeugung ändern — alte PDFs sollen weiter ladbar bleiben.

import { createClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';

interface AuthedUser { id: string; role: 'admin' | 'fahrer' | null }

interface FormularRow {
  id: string;
  fahrer_id: string;
  zwischenprotokoll_url: string | null;
  fahrer: { user_id: string } | null;
}

const ALLOWED_ROOTS = [
  'Maja-Logistik/Formulare/',
  'Maja-Logistik/Zwischenprotokolle/',
  'Maja-Logistik/Belege/',
];

function userClient(token: string) {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');
  // Wichtig: Authorization-Header setzen, damit RLS den User sieht.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Prüft, ob `user` die Zeile per RLS lesen darf, und ob `path` plausibel
 * dazu gehört (Wurzel-Prefix oder exakte zwischenprotokoll_url).
 * Wirft HttpError(403/404), wenn nicht.
 */
export async function assertCanAccessPdfPath(
  user: AuthedUser, token: string, formularId: string, path: string,
): Promise<void> {
  const supa = userClient(token);
  const { data, error } = await supa
    .from('ausgefuellte_formulare')
    .select('id, fahrer_id, zwischenprotokoll_url, fahrer:fahrer_id (user_id)')
    .eq('id', formularId)
    .maybeSingle();

  if (error) throw new HttpError(500, `DB-Fehler: ${error.message}`);
  if (!data) throw new HttpError(404, 'Formular nicht gefunden oder kein Zugriff');

  const formular = data as unknown as FormularRow;

  // RLS hat bereits Admin vs. Fahrer-eigene-Zeile geprüft. Defensive
  // Doppel-Prüfung für Fahrer, falls eine künftige Migration die RLS
  // lockert.
  if (user.role !== 'admin' && user.role !== null) {
    if (!formular.fahrer || formular.fahrer.user_id !== user.id) {
      throw new HttpError(403, 'Keine Berechtigung für dieses Formular');
    }
  }

  const normalized = path.replace(/^\/+/, '');
  const isZwischen = !!formular.zwischenprotokoll_url
    && formular.zwischenprotokoll_url.replace(/^\/+/, '') === normalized;
  const inAllowedRoot = ALLOWED_ROOTS.some((r) => normalized.startsWith(r));
  if (!isZwischen && !inAllowedRoot) {
    throw new HttpError(403, 'Pfad nicht erlaubt');
  }
}
