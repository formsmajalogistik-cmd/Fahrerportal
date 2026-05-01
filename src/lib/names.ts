import type { AppUser } from '../types/db';

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
