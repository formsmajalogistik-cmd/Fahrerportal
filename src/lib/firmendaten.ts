// Firmendaten des Rechnungsausstellers (Maja-Logistik) — EINE Quelle
// für PDF und E-Rechnung.
//
// Seit Migration 116 in den Admin-Einstellungen gepflegt (app_settings,
// Schlüssel 'firmendaten'). Beim Erstellen einer Rechnung/Gutschrift
// werden sie als Snapshot am Beleg gespeichert (absender_snapshot);
// PDF und XML eines erstellten Belegs lesen immer seinen Snapshot.
// FIRMENDATEN unten sind die Vorgabewerte (= bisherige Werte im Code).

import { supabase } from './supabase';
import type { Json } from '../types/supabase';

export interface Firmendaten {
  /** Firmenname genau wie im Handelsregister (BT-27). */
  name: string;
  /** Kurzbezeichnung, erste Zeile der Fußzeile. */
  kurzname: string;
  inhaber: string | null;
  rechtsform: string | null;
  registergericht: string | null;
  registernummer: string | null;
  strasse: string;
  plz: string;
  ort: string;
  /** ISO 3166-1 alpha-2 (BT-40). */
  landCode: string;
  /** Telefon/E-Mail im Briefkopf. */
  telefon: string;
  email: string;
  /** USt-IdNr. (BT-31). */
  ustId: string;
  /** Steuernummer (BT-32). */
  steuernummer: string | null;
  /** Kontakt für Rechnungen (BT-41/42/43, Pflicht bei XRechnung). */
  kontaktName: string | null;
  kontaktTelefon: string | null;
  kontaktEmail: string | null;
  /** Elektronische Adresse des Absenders (BT-34). */
  elektronischeAdresse: string;
  iban: string;
  bic: string;
  bank: string | null;
}

export const FIRMENDATEN: Readonly<Firmendaten> = Object.freeze({
  name: 'Maja-Logistik M.Janßen',
  kurzname: 'Maja-Logistik',
  inhaber: null,
  rechtsform: null,
  registergericht: null,
  registernummer: null,
  strasse: 'Heiligenroder Strasse 38e',
  plz: '28816',
  ort: 'Stuhr-Heiligenrode',
  landCode: 'DE',
  telefon: '+49 17641461645',
  email: 'info@maja-logistik.de',
  ustId: 'DE309356726',
  steuernummer: null,
  kontaktName: null,
  kontaktTelefon: '+49 17641461645',
  kontaktEmail: 'info@maja-logistik.de',
  elektronischeAdresse: 'info@maja-logistik.de',
  iban: 'DE04280501000001429760',
  bic: 'SLZODE22XXX',
  bank: null,
});

/** „28816 Stuhr-Heiligenrode". */
export function firmaPlzOrt(f: Pick<Firmendaten, 'plz' | 'ort'> = FIRMENDATEN): string {
  return `${f.plz} ${f.ort}`;
}

/** Registerangabe „Amtsgericht Walsrode HRA 1234" oder null. */
export function firmaRegister(f: Firmendaten): string | null {
  const s = [f.registergericht, f.registernummer].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
  return s || null;
}

const SCHLUESSEL: Record<keyof Firmendaten, string> = {
  name: 'firmenname', kurzname: 'kurzname', inhaber: 'inhaber', rechtsform: 'rechtsform',
  registergericht: 'registergericht', registernummer: 'registernummer',
  strasse: 'strasse', plz: 'plz', ort: 'ort', landCode: 'land_code',
  telefon: 'telefon', email: 'email', ustId: 'ust_id', steuernummer: 'steuernummer',
  kontaktName: 'kontakt_name', kontaktTelefon: 'kontakt_telefon', kontaktEmail: 'kontakt_email',
  elektronischeAdresse: 'elektronische_adresse', iban: 'iban', bic: 'bic', bank: 'bank',
};
const OPTIONAL = new Set<keyof Firmendaten>(['inhaber', 'rechtsform', 'registergericht', 'registernummer',
  'steuernummer', 'kontaktName', 'kontaktTelefon', 'kontaktEmail', 'bank']);

/** JSON (Einstellung oder Snapshot) → Firmendaten; Lücken = Vorgabewerte. */
export function firmendatenAusJson(raw: unknown): Firmendaten {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...FIRMENDATEN } as Record<keyof Firmendaten, string | null>;
  for (const k of Object.keys(SCHLUESSEL) as (keyof Firmendaten)[]) {
    const v = o[SCHLUESSEL[k]];
    if (typeof v === 'string') out[k] = v.trim() === '' && OPTIONAL.has(k) ? null : v.trim();
    else if (v === null && OPTIONAL.has(k)) out[k] = null;
  }
  return out as unknown as Firmendaten;
}

export function firmendatenZuJson(f: Firmendaten): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(SCHLUESSEL) as (keyof Firmendaten)[]) {
    const v = f[k];
    out[SCHLUESSEL[k]] = typeof v === 'string' && v.trim() !== '' ? v.trim() : (OPTIONAL.has(k) ? null : (v ?? ''));
  }
  return out;
}

/** Aktuelle Einstellung (ohne Eintrag: Vorgabewerte). */
export async function ladeFirmendaten(): Promise<Firmendaten> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'firmendaten').maybeSingle();
  if (error) console.warn('[firmendaten.laden]', error.message);
  return firmendatenAusJson(data?.value ?? null);
}

export async function speichereFirmendaten(f: Firmendaten): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'firmendaten', value: firmendatenZuJson(f) as unknown as Json }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/**
 * Firmendaten für einen Beleg: der Snapshot, falls vorhanden — sonst
 * (Belege von vor Migration 116 bzw. Entwürfe) die aktuelle Einstellung.
 */
export async function firmendatenFuerBeleg(snapshot: unknown): Promise<{ firma: Firmendaten; ausSnapshot: boolean }> {
  if (snapshot && typeof snapshot === 'object') return { firma: firmendatenAusJson(snapshot), ausSnapshot: true };
  return { firma: await ladeFirmendaten(), ausSnapshot: false };
}

/** Pflichtfelder der Einstellungsseite (leer = Fehlermeldung). */
export function pruefeFirmendaten(f: Firmendaten): string[] {
  const m: string[] = [];
  const leer = (v: string | null) => !v || !v.trim();
  if (leer(f.name)) m.push('Firmenname fehlt');
  if (leer(f.strasse) || leer(f.plz) || leer(f.ort)) m.push('Anschrift unvollständig');
  if (!/^[A-Z]{2}$/.test(f.landCode)) m.push('Ländercode: zwei Großbuchstaben (z.B. DE)');
  if (leer(f.ustId) && leer(f.steuernummer)) m.push('USt-IdNr. oder Steuernummer fehlt');
  if (leer(f.iban)) m.push('IBAN fehlt');
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.test(f.elektronischeAdresse)) m.push('Elektronische Adresse: keine gültige E-Mail');
  if (f.kontaktEmail && !email.test(f.kontaktEmail)) m.push('Kontakt-E-Mail ungültig');
  return m;
}
