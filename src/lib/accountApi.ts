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

export interface EmailAenderungErgebnis {
  alteEmail: string;
  neueEmail: string;
  /** 'gesendet' oder 'fehler: …' — Info-Mail an die neue Adresse. */
  infoMail: string;
}

/**
 * Ändert die E-Mail-Adresse eines Kontos (Login UND Zustelladresse).
 * Nur für Admins; Prüfung und Änderung laufen serverseitig mit dem
 * Service-Role-Key (api/account.ts, Aktion change-email).
 */
export async function changeEmail(
  userId: string, neueEmail: string, neueEmailWiederholung: string,
): Promise<EmailAenderungErgebnis> {
  const token = await getValidToken();
  if (!token) throw new Error('Nicht angemeldet — bitte neu einloggen.');
  const res = await fetch('/api/account?action=change-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, neueEmail, neueEmailWiederholung }),
  });
  let data: { error?: string } & Partial<EmailAenderungErgebnis> = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error ?? `E-Mail ändern fehlgeschlagen (HTTP ${res.status})`);
  return { alteEmail: data.alteEmail ?? '', neueEmail: data.neueEmail ?? '', infoMail: data.infoMail ?? '' };
}
