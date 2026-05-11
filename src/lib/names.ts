import type { AppUser, Fahrer } from '../types/db';

export function displayName(p: Pick<AppUser, 'vorname' | 'nachname' | 'email'> | null | undefined): string {
  if (!p) return '';
  const full = [p.vorname, p.nachname].filter(Boolean).join(' ').trim();
  return full || p.email;
}

export function initials(p: Pick<AppUser, 'vorname' | 'nachname' | 'email'> | null | undefined): string {
  if (!p) return '?';
  const v = (p.vorname ?? '').trim()[0] ?? '';
  const n = (p.nachname ?? '').trim()[0] ?? '';
  const both = (v + n).trim();
  if (both) return both.toUpperCase();
  return (p.email ?? '?').trim()[0]?.toUpperCase() ?? '?';
}

/**
 * Name eines Fahrer-Eintrags: bei Unterkonten oder wenn auf dem Fahrer
 * eigene Vor-/Nachnamen gepflegt sind, werden diese verwendet. Sonst
 * fällt der Name auf den zugehörigen Auth-User (app_users) zurück.
 */
export function fahrerName(
  f: Pick<Fahrer, 'vorname' | 'nachname'> | null | undefined,
  fallbackUser: Pick<AppUser, 'vorname' | 'nachname' | 'email'> | null | undefined,
): string {
  const own = [f?.vorname, f?.nachname].filter(Boolean).join(' ').trim();
  if (own) return own;
  return displayName(fallbackUser ?? null);
}
