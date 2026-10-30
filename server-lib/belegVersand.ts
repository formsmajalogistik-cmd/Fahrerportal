// Versand einer Rechnung/Gutschrift serverseitig protokollieren
// (Migration 111) — direkt nach der Antwort von Microsoft Graph, damit
// „Versendet (App)" erst nach bestätigtem Versand entsteht und auch dann
// gespeichert wird, wenn der Browser danach weg ist. Läuft mit dem
// Token des Benutzers: die Datenbankfunktion prüft Admin und stempelt
// Benutzer + Zeitpunkt.

import { createClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';

export interface VersandBeleg { typ: 'rechnung' | 'gutschrift'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseVersandBeleg(v: unknown): VersandBeleg | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { typ?: unknown; id?: unknown };
  if ((o.typ !== 'rechnung' && o.typ !== 'gutschrift') || typeof o.id !== 'string' || !UUID.test(o.id)) {
    throw new HttpError(400, 'versand_beleg ungültig');
  }
  return { typ: o.typ, id: o.id };
}

/** Liefert true, wenn der Eintrag gespeichert wurde. Wirft nie. */
export async function versandProtokollieren(
  token: string,
  beleg: VersandBeleg,
  art: 'app' | 'fehlgeschlagen',
  daten: { empfaenger: string[]; cc: string[]; absender: string | null; betreff: string | null; fehler?: string | null },
): Promise<boolean> {
  try {
    const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return false;
    const supa = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { error } = await supa.rpc('beleg_versand_eintragen', {
      p_typ: beleg.typ, p_id: beleg.id, p_art: art, p_weg: null, p_datum: null,
      p_empfaenger: daten.empfaenger, p_cc: daten.cc, p_absender: daten.absender,
      p_betreff: daten.betreff, p_notiz: null, p_fehler: daten.fehler ? daten.fehler.slice(0, 500) : null,
    });
    if (error) {
      console.warn('[belegVersand] Protokoll fehlgeschlagen', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[belegVersand] Protokoll fehlgeschlagen', e);
    return false;
  }
}
