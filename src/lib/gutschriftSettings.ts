// Konfiguration des Gutschrift-Dokuments (Migration 078).
//
// Hintergrund: Welcher Begriff auf dem Dokument steht, gibt der
// Steuerberater vor — "Gutschrift", "Rechnungskorrektur" oder
// "Storno-Rechnung". Damit das ohne Code-Änderung umstellbar ist, liegen
// Bezeichnung, Nummernformat und die Standard-Texte in app_settings
// (Key `gutschrift_einstellungen`, Admin-only per RLS).
//
// Die gewählte Bezeichnung wird in der PDF-Überschrift, im E-Mail-Betreff
// und in der Übersicht verwendet.

import { supabase } from './supabase';
import type { Json } from '../types/supabase';

const KEY = 'gutschrift_einstellungen';

export interface GutschriftSettings {
  /** Überschrift des Dokuments — auch Betreff und Übersichts-Titel. */
  dokumentbezeichnung: string;
  /** Nummernformat mit den Platzhaltern {Jahr} und {Nr}. */
  nummernformat: string;
  /** Steht unter der Anrede, vor der Positionstabelle. */
  einleitungstext: string;
  /** Steht unter dem Summenblock, vor dem Gruß. */
  schlusstext: string;
  /** Beschriftung der Brutto-Zeile im Summenblock. */
  summen_label: string;
}

export const DEFAULT_GUTSCHRIFT_SETTINGS: GutschriftSettings = {
  dokumentbezeichnung: 'Gutschrift',
  nummernformat: 'GS-{Jahr}/{Nr}',
  einleitungstext: 'wir schreiben Ihnen folgende Positionen gut:',
  schlusstext:
    'Der Betrag wird Ihrem Konto gutgeschrieben bzw. mit der nächsten '
    + 'Rechnung verrechnet.',
  summen_label: 'Gutschriftbetrag',
};

/** Vorschläge für das Bezeichnungs-Feld — freie Eingabe bleibt möglich. */
export const DOKUMENTBEZEICHNUNG_VORSCHLAEGE = [
  'Gutschrift',
  'Rechnungskorrektur',
  'Storno-Rechnung',
];

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

export function parseGutschriftSettings(raw: unknown): GutschriftSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_GUTSCHRIFT_SETTINGS;
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_GUTSCHRIFT_SETTINGS;
  return {
    dokumentbezeichnung: asString(o.dokumentbezeichnung, d.dokumentbezeichnung),
    nummernformat: asString(o.nummernformat, d.nummernformat),
    // Die Texte dürfen bewusst LEER sein — daher kein Fallback auf den
    // Default, sobald der Admin sie einmal geleert hat.
    einleitungstext: typeof o.einleitungstext === 'string' ? o.einleitungstext : d.einleitungstext,
    schlusstext: typeof o.schlusstext === 'string' ? o.schlusstext : d.schlusstext,
    summen_label: asString(o.summen_label, d.summen_label),
  };
}

export async function loadGutschriftSettings(): Promise<GutschriftSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  if (error) {
    console.warn('[gutschriftSettings.load]', error.message);
    return DEFAULT_GUTSCHRIFT_SETTINGS;
  }
  return parseGutschriftSettings(data?.value ?? null);
}

export async function saveGutschriftSettings(cfg: GutschriftSettings): Promise<void> {
  const value: GutschriftSettings = {
    dokumentbezeichnung: cfg.dokumentbezeichnung.trim() || DEFAULT_GUTSCHRIFT_SETTINGS.dokumentbezeichnung,
    nummernformat: cfg.nummernformat.trim() || DEFAULT_GUTSCHRIFT_SETTINGS.nummernformat,
    einleitungstext: cfg.einleitungstext,
    schlusstext: cfg.schlusstext,
    summen_label: cfg.summen_label.trim() || DEFAULT_GUTSCHRIFT_SETTINGS.summen_label,
  };
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: KEY, value: value as unknown as Json }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/**
 * Beispiel-Nummer für die Vorschau im Einstellungs-Formular. Die echte
 * Vergabe passiert serverseitig (`next_gutschrift_nr`) — hier geht es
 * nur darum, dem Admin zu zeigen, wie sein Format aussieht.
 */
export function beispielNummer(format: string, jahr = new Date().getFullYear()): string {
  const mitJahr = format.replace(/\{Jahr\}/g, String(jahr));
  return mitJahr.includes('{Nr}')
    ? mitJahr.replace(/\{Nr\}/g, '1')
    : `${mitJahr}1`;
}
