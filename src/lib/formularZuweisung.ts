// Begonnenes Formular einem anderen Fahrer zuweisen (Migration 108) —
// reine Hilfsregeln, ohne Supabase, damit sie für sich prüfbar sind.

import type { FormSchema } from '../types/db';

const FAHRERNAME = /(fahrer.?name|name.?fahrer|^fahrer$)/i;

/** Textfelder, die den Namen des Fahrers aufnehmen (z.B. „fahrername", „fahrername_uebergabe"). */
export function fahrernamenFelder(schema: FormSchema): string[] {
  return (schema.sections ?? []).flatMap((s) => s.fields ?? [])
    .filter((f) => f.type === 'text' && (FAHRERNAME.test(f.id) || (/fahrer/i.test(f.label) && /name/i.test(f.label))))
    .map((f) => f.id);
}

/**
 * Nach einer Zuweisung: Fahrername-Felder, die noch LEER sind, mit dem
 * neuen Fahrer vorbelegen. Was Fahrer A schon eingetragen hat (z.B. im
 * Übernahme-Teil), bleibt unverändert — A wird nie still durch B ersetzt.
 */
export function fahrernameVorbelegen(
  schema: FormSchema, daten: Record<string, unknown>, name: string,
): { daten: Record<string, unknown>; gesetzt: string[] } {
  const gesetzt: string[] = [];
  if (!name.trim()) return { daten, gesetzt };
  let next = daten;
  for (const id of fahrernamenFelder(schema)) {
    const v = daten[id];
    if (typeof v === 'string' ? v.trim() !== '' : v != null) continue;
    if (next === daten) next = { ...daten };
    next[id] = name;
    gesetzt.push(id);
  }
  return { daten: next, gesetzt };
}

/** User-Agent → „iPhone, Browser" / „Android, App" … */
export function geraetKurz(geraet: string | null | undefined): string | null {
  if (!geraet) return null;
  const ua = geraet;
  const typ = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Gerät';
  const modus = /\|\s*PWA\b/.test(ua) ? 'App' : /\|\s*Browser\b/.test(ua) ? 'Browser' : null;
  return modus ? `${typ}, ${modus}` : typ;
}

/** Letzte Server-Speicherung liegt weit zurück → Hinweis, A könnte noch Änderungen auf dem Gerät haben. */
export function speicherungVeraltet(geaendertAm: string | null | undefined, jetzt = Date.now(), grenzeMin = 30): boolean {
  if (!geaendertAm) return true;
  const t = Date.parse(geaendertAm);
  return !Number.isFinite(t) || jetzt - t > grenzeMin * 60_000;
}
