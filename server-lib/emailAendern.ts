// E-Mail-Adresse eines Kontos prüfen und normalisieren — serverseitig
// (api/account.ts). Rein, damit die Regeln testbar sind.

/** Bewusst schlicht: genau ein @, Punkt in der Domain, keine Leerzeichen. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalisiereEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export type EmailPruefung =
  | { ok: true; email: string }
  | { ok: false; status: number; fehler: string };

/**
 * Prüft die beiden Eingaben des Admins. Gleichheit wird NACH der
 * Normalisierung verglichen — „Max@Firma.de " und „max@firma.de" sind
 * dieselbe Adresse.
 */
export function pruefeNeueEmail(neu: unknown, wiederholung: unknown, alt: string | null): EmailPruefung {
  const a = normalisiereEmail(neu);
  const b = normalisiereEmail(wiederholung);
  if (!a) return { ok: false, status: 400, fehler: 'Bitte die neue E-Mail-Adresse eingeben.' };
  if (a.length > 254 || !EMAIL_RE.test(a)) {
    return { ok: false, status: 400, fehler: `„${a}" ist keine gültige E-Mail-Adresse.` };
  }
  if (a !== b) return { ok: false, status: 400, fehler: 'Die beiden Eingaben stimmen nicht überein.' };
  if (alt && a === normalisiereEmail(alt)) {
    return { ok: false, status: 400, fehler: 'Die neue Adresse ist identisch mit der bisherigen.' };
  }
  return { ok: true, email: a };
}
