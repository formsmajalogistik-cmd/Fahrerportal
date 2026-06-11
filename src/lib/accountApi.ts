import { getValidToken } from './supabase';

/**
 * Löscht ein Benutzerkonto (app_users-Eintrag, fahrer-Einträge,
 * Auth-User). Optional werden alle referenzierten Touren und Formulare
 * an einen anderen Fahrer-Eintrag übertragen. Ohne `transferToFahrerId`
 * werden Touren auf NULL gesetzt; existierende Formulare führen zum
 * Abbruch, weil ausgefuellte_formulare.fahrer_id NOT NULL ist.
 *
 * Endpoint läuft mit dem SUPABASE_SERVICE_ROLE_KEY serverseitig — der
 * Frontend-Client hat diesen Key nicht.
 */
export async function deleteAccount(
  userId: string,
  transferToFahrerId: string | null,
): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new Error('Nicht angemeldet — bitte neu einloggen.');
  const res = await fetch('/api/account?action=delete-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, transferToFahrerId }),
  });
  if (!res.ok) {
    let msg = `Konto löschen fehlgeschlagen (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
}
