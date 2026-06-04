// Server-side guard für die Mail-Endpunkte: stellt sicher, dass nur
// auf die in app_settings hinterlegten Postfächer zugegriffen wird,
// damit der globale Server-Token nicht für beliebige Adressen
// missbraucht werden kann.

import { createClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';

function userClient(token: string) {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Liefert die Liste der erlaubten Mailbox-Adressen aus app_settings
 * (keys `mail_inbox_1`, `mail_inbox_2`). Adressen werden lower-case
 * normalisiert. Leere oder fehlende Einträge werden übersprungen.
 */
async function configuredMailboxes(token: string): Promise<string[]> {
  const supa = userClient(token);
  const { data, error } = await supa
    .from('app_settings')
    .select('value')
    .in('key', ['mail_inbox_1', 'mail_inbox_2']);
  if (error) {
    throw new HttpError(500, `app_settings-Lookup fehlgeschlagen: ${error.message}`);
  }
  const out: string[] = [];
  for (const row of (data ?? []) as Array<{ value: { address?: string } | null }>) {
    const a = row.value?.address;
    if (typeof a === 'string' && a.trim() !== '') {
      out.push(a.trim().toLowerCase());
    }
  }
  return out;
}

/**
 * Wirft 403, wenn `mailbox` NICHT zu den konfigurierten Postfächern
 * gehört. Schutz vor IDOR / scope-creep beim Graph-Token.
 */
export async function assertMailboxAllowed(
  token: string, mailbox: string,
): Promise<void> {
  const m = mailbox.trim().toLowerCase();
  if (!m) throw new HttpError(400, 'mailbox fehlt');
  const allowed = await configuredMailboxes(token);
  if (allowed.length === 0) {
    throw new HttpError(400, 'Keine Postfächer konfiguriert. Bitte unter Einstellungen anlegen.');
  }
  if (!allowed.includes(m)) {
    throw new HttpError(403, `Postfach "${mailbox}" ist nicht freigeschaltet.`);
  }
}
