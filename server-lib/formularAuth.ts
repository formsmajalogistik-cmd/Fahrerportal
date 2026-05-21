// Pro-Resource-Authorization für /api/download und /api/delete-pdf.
// Der Client schickt formular_id + path; der Server prüft:
//   1) Darf der eingeloggte User dieses Formular sehen?
//      Admin → ja; Fahrer → fahrer.user_id muss matchen.
//   2) Gehört der Pfad zu diesem Formular?
//      Erlaubt sind:
//        a) ein Pfad innerhalb des Formular-Ordners (= reguläre PDFs),
//        b) der in zwischenprotokoll_url hinterlegte Pfad.

import { createClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';
import { buildFormularFolder } from './paths.js';

interface AuthedUser { id: string; role: 'admin' | 'fahrer' | null }

interface FormularRow {
  id: string;
  fahrer_id: string;
  created_at: string;
  daten: Record<string, unknown> | null;
  zwischenprotokoll_url: string | null;
  template: { name: string } | null;
  fahrer: { user_id: string } | null;
}

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.VITE_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function loadFormularForAuth(formularId: string): Promise<FormularRow | null> {
  const supa = serviceClient();
  const { data, error } = await supa
    .from('ausgefuellte_formulare')
    .select(`
      id, fahrer_id, created_at, daten, zwischenprotokoll_url,
      template:template_id (name),
      fahrer:fahrer_id (user_id)
    `)
    .eq('id', formularId)
    .maybeSingle();
  if (error) throw new HttpError(500, `DB-Fehler: ${error.message}`);
  return (data as unknown as FormularRow) ?? null;
}

/**
 * Prüft, ob `user` das Formular sehen darf UND ob `path` zu diesem
 * Formular gehört (Formular-Ordner-Prefix oder zwischenprotokoll_url).
 * Wirft HttpError(403) bei Zugriffsverletzungen.
 */
export async function assertCanAccessPdfPath(
  user: AuthedUser, formularId: string, path: string,
): Promise<void> {
  const formular = await loadFormularForAuth(formularId);
  if (!formular) throw new HttpError(404, 'Formular nicht gefunden');

  // 1. Rollencheck.
  if (user.role !== 'admin') {
    if (!formular.fahrer || formular.fahrer.user_id !== user.id) {
      throw new HttpError(403, 'Keine Berechtigung für dieses Formular');
    }
  }

  // 2. Pfadcheck.
  const isoDate = (formular.created_at ?? new Date().toISOString()).slice(0, 10);
  const daten = formular.daten ?? {};
  const kennzeichenRaw = daten['kennzeichen'] ?? daten['Kennzeichen'];
  const folder = buildFormularFolder({
    date: isoDate,
    kennzeichen: typeof kennzeichenRaw === 'string' ? kennzeichenRaw : null,
    templateName: formular.template?.name ?? 'unbenannt',
    formularId: formular.id,
  });

  const normalized = path.replace(/^\/+/, '');
  const inFolder = normalized.startsWith(`${folder}/`) || normalized === folder;
  const isZwischen = !!formular.zwischenprotokoll_url
    && formular.zwischenprotokoll_url.replace(/^\/+/, '') === normalized;
  if (!inFolder && !isZwischen) {
    throw new HttpError(403, 'Pfad gehört nicht zu diesem Formular');
  }
}
