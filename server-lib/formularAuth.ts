// Pro-Resource-Authorization für /api/download und /api/delete-pdf.
//
// Der Client schickt formular_id + path. Auf dem Server:
//   1) Wir laden die Zeile MIT dem JWT des Users — RLS entscheidet,
//      ob er sie sehen darf. Findet der SELECT die Zeile, ist der
//      User berechtigt; sonst 404. Damit funktioniert die Prüfung
//      auch für Haupt-User mit Unterkonto, ohne dass die brüchige
//      `fahrer.user_id === user.id`-Doppelprüfung greift.
//   2) Pfad-Sanity: pro Rolle eine eigene Whitelist erlaubter
//      Wurzel-Ordner. Fahrer dürfen NUR Formulare/Zwischenprotokolle
//      sehen — keine Belege, keine Rechnungen, keine Preislisten.

import { createClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';

interface AuthedUser { id: string; role: 'admin' | 'fahrer' | 'auftraggeber' | 'test' | null }

interface FormularRow {
  id: string;
  fahrer_id: string;
  zwischenprotokoll_url: string | null;
}

const FAHRER_ALLOWED_ROOTS = [
  'Maja-Logistik/Formulare/',
  'Maja-Logistik/Zwischenprotokolle/',
];

const ADMIN_ALLOWED_ROOTS = [
  ...FAHRER_ALLOWED_ROOTS,
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
  // RLS auf ausgefuellte_formulare:
  //   - Admin sieht alles.
  //   - Fahrer (auch Haupt mit Unterkonto) sieht eigene Zeilen via
  //     fahrer_belongs_to_me(fahrer_id).
  // Findet der SELECT die Zeile → Zugriff freigegeben.
  const { data, error } = await supa
    .from('ausgefuellte_formulare')
    .select('id, fahrer_id, zwischenprotokoll_url')
    .eq('id', formularId)
    .maybeSingle();

  console.info('[assertCanAccessPdfPath]', {
    userId: user.id,
    role: user.role,
    isAdmin: user.role === 'admin',
    formularId,
    path,
    rowFound: !!data,
    rlsError: error?.message ?? null,
  });

  if (error) throw new HttpError(500, `DB-Fehler: ${error.message}`);
  if (!data) throw new HttpError(404, 'Formular nicht gefunden oder kein Zugriff');

  const formular = data as unknown as FormularRow;

  const normalized = path.replace(/^\/+/, '');
  const isZwischen = !!formular.zwischenprotokoll_url
    && formular.zwischenprotokoll_url.replace(/^\/+/, '') === normalized;
  const allowedRoots = user.role === 'admin' ? ADMIN_ALLOWED_ROOTS : FAHRER_ALLOWED_ROOTS;
  const inAllowedRoot = allowedRoots.some((r) => normalized.startsWith(r));
  if (!isZwischen && !inAllowedRoot) {
    throw new HttpError(403, 'Pfad nicht erlaubt');
  }
}

/**
 * Autorisierung für Tour-Dokumente (extern hochgeladene Protokolle,
 * Migration 076). Gleiches Prinzip wie assertCanAccessPdfPath: die Zeile
 * wird MIT dem JWT des Users gelesen — findet RLS sie, ist er berechtigt
 * (Admin, Auftraggeber der Tour, Fahrer der Tour, Test read-only).
 * Zusätzlich muss der angefragte Pfad exakt der gespeicherte sein, damit
 * eine gültige Dokument-Id nicht als Generalschlüssel taugt.
 */
export async function assertCanAccessTourDokument(
  user: AuthedUser, token: string, dokumentId: string, path: string,
): Promise<void> {
  const supa = userClient(token);
  const { data, error } = await supa
    .from('tour_dokumente')
    .select('id, onedrive_path')
    .eq('id', dokumentId)
    .maybeSingle();
  if (error) throw new HttpError(500, `DB-Fehler: ${error.message}`);
  if (!data) throw new HttpError(404, 'Dokument nicht gefunden oder kein Zugriff');
  const row = data as unknown as { onedrive_path: string };
  const norm = (p: string) => p.replace(/^\/+/, '');
  if (norm(row.onedrive_path) !== norm(path)) {
    throw new HttpError(403, 'Pfad gehört nicht zu diesem Dokument');
  }
  console.info('[assertCanAccessTourDokument]', {
    userId: user.id, role: user.role, dokumentId, path,
  });
}
