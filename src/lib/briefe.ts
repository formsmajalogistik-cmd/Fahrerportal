// Briefe, Brief-Vorlagen und Tankkarten (Migration 091).
//
// Bewusst nah am Rechnungsmodul: derselbe Adress-Snapshot, dieselbe
// Nummernserien-Mechanik, dasselbe PDF-Layout, derselbe E-Mail-Weg.
//
// Zugriff: Admin-only. Einzige Ausnahme ist der Fahrer, dem ein Brief
// GESENDET wurde — er darf ihn lesen und über die RPC unterschreiben.
// Auftraggeber- und Test-Konten haben keinerlei Zugriff (RLS).

import { supabase } from './supabase';
import { buildAnrede } from './rechnungsformat';
import type { Database, Json } from '../types/supabase';

export type Brief = Database['public']['Tables']['briefe']['Row'];
export type BriefVorlage = Database['public']['Tables']['brief_vorlagen']['Row'];
export type Tankkarte = Database['public']['Tables']['tankkarten']['Row'];

export type BriefStatus = 'entwurf' | 'final' | 'versendet' | 'unterschrieben';
export type TankkartenStatus = 'aktiv' | 'zurueckgegeben' | 'gesperrt';

export const BRIEF_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  final: 'Final',
  versendet: 'Versendet',
  unterschrieben: 'Unterschrieben',
};

export const TANKKARTEN_STATUS_LABEL: Record<string, string> = {
  aktiv: 'Aktiv',
  zurueckgegeben: 'Zurückgegeben',
  gesperrt: 'Gesperrt',
};

/**
 * Empfänger-Adresse eines Briefs. Gleiche Form wie der Snapshot der
 * Gutschriften (078) — dadurch kann der PDF-Renderer denselben
 * Adressblock zeichnen.
 */
export interface BriefAdresse {
  firma: string;
  anrede: string;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
}

export function leereBriefAdresse(): BriefAdresse {
  return { firma: '', anrede: '', vorname: '', nachname: '', strasse: '', plz: '', ort: '' };
}

const t = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseBriefAdresse(raw: unknown): BriefAdresse {
  if (!raw || typeof raw !== 'object') return leereBriefAdresse();
  const o = raw as Record<string, unknown>;
  return {
    firma: t(o.firma), anrede: t(o.anrede), vorname: t(o.vorname),
    nachname: t(o.nachname), strasse: t(o.strasse), plz: t(o.plz), ort: t(o.ort),
  };
}

/** "Herr Max Mustermann" — Format, das buildAnrede() erwartet. */
export function empfaengerName(a: BriefAdresse): string {
  return [a.anrede, a.vorname, a.nachname].filter(Boolean).join(' ');
}

/** Anzeigename für Listen: Firma, sonst Name. */
export function empfaengerAnzeige(a: BriefAdresse): string {
  const name = [a.vorname, a.nachname].filter(Boolean).join(' ');
  return a.firma || name || 'Ohne Empfänger';
}

/**
 * Adressblock-Zeilen. Leere Teile fallen weg — eine Privatperson ohne
 * Firma bekommt keine Leerzeile.
 */
export function adressZeilen(a: BriefAdresse): string[] {
  const zeilen: string[] = [];
  if (a.firma) zeilen.push(a.firma);
  const name = empfaengerName(a);
  if (name) zeilen.push(name);
  if (a.strasse) zeilen.push(a.strasse);
  const ortszeile = [a.plz, a.ort].filter(Boolean).join(' ');
  if (ortszeile) zeilen.push(ortszeile);
  return zeilen;
}

// ---------------------------------------------------------------
// Platzhalter
// ---------------------------------------------------------------

export const BRIEF_PLATZHALTER: Array<{ token: string; label: string }> = [
  { token: '{empfaenger_name}', label: 'Empfänger — Name' },
  { token: '{empfaenger_anrede}', label: 'Empfänger — Brief-Anrede' },
  { token: '{empfaenger_nachname}', label: 'Empfänger — Nachname' },
  { token: '{empfaenger_adresse}', label: 'Empfänger — Adresse' },
  { token: '{datum}', label: 'Datum' },
  { token: '{brief_nr}', label: 'Brief-Nummer' },
  { token: '{tankkarte_anbieter}', label: 'Tankkarte — Anbieter' },
  { token: '{tankkarte_nummer}', label: 'Tankkarte — Nummer' },
  { token: '{fahrer_name}', label: 'Fahrer — Name' },
];

export interface PlatzhalterKontext {
  adresse: BriefAdresse;
  datum: string;
  briefNr: string;
  tankkarte?: Pick<Tankkarte, 'anbieter' | 'kartennummer'> | null;
  fahrerName?: string | null;
}

function datumDe(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE');
}

/**
 * Platzhalter im Text ersetzen. Nicht belegte Platzhalter werden zu
 * einer leeren Zeichenkette — kein "undefined" im fertigen Brief.
 *
 * Die Brief-Anrede entsteht über dieselbe buildAnrede()-Logik wie bei
 * Rechnungen ("Herr Max Mustermann" → "Sehr geehrter Herr Mustermann,").
 */
export function loesePlatzhalter(text: string, ctx: PlatzhalterKontext): string {
  const werte: Record<string, string> = {
    '{empfaenger_name}': empfaengerName(ctx.adresse) || ctx.adresse.firma,
    '{empfaenger_anrede}': buildAnrede(empfaengerName(ctx.adresse)),
    '{empfaenger_nachname}': ctx.adresse.nachname,
    '{empfaenger_adresse}': adressZeilen(ctx.adresse).join(', '),
    '{datum}': datumDe(ctx.datum),
    '{brief_nr}': ctx.briefNr,
    '{tankkarte_anbieter}': ctx.tankkarte?.anbieter ?? '',
    '{tankkarte_nummer}': ctx.tankkarte?.kartennummer ?? '',
    '{fahrer_name}': ctx.fahrerName ?? '',
  };
  let out = text;
  for (const [token, wert] of Object.entries(werte)) {
    out = out.split(token).join(wert);
  }
  return out;
}

// ---------------------------------------------------------------
// Datenzugriff
// ---------------------------------------------------------------

export async function ladeVorlagen(): Promise<BriefVorlage[]> {
  const { data, error } = await supabase
    .from('brief_vorlagen').select('*').order('name');
  if (error) { console.warn('[briefe] Vorlagen', error.message); return []; }
  return (data as BriefVorlage[]) ?? [];
}

export async function naechsteBriefNr(jahr: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_brief_nr', { p_year: jahr });
  if (error) { console.warn('[briefe] Nummer', error.message); return null; }
  return typeof data === 'string' ? data : null;
}

export async function unterschreibeBrief(
  briefId: string, unterschrift: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const { data, error } = await supabase.rpc('brief_unterschreiben', {
    p_brief_id: briefId,
    p_unterschrift: unterschrift,
  });
  if (error) {
    console.warn('[briefe] Unterschreiben', error.message);
    return { ok: false, fehler: 'Die Unterschrift konnte nicht gespeichert werden.' };
  }
  return (data as unknown as { ok: boolean; fehler?: string })
    ?? { ok: false, fehler: 'Keine Antwort vom Server.' };
}

/** Snapshot als Json für die Spalte. */
export function adresseAlsJson(a: BriefAdresse): Json {
  return { ...a } as unknown as Json;
}
