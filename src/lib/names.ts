import type { AppUser } from '../types/db';

export function displayName(p: Pick<AppUser, 'vorname' | 'nachname' | 'email'> | null | undefined): string {
  if (!p) return '';
  const full = [p.vorname, p.nachname].filter(Boolean).join(' ').trim();
  return full || p.email;
}
