// Niederlassungen eines Auftraggebers (Migration 118) — die EINE Stelle für
// Laden, Anzeige „Auftraggeber · Ort", Auswahl-Optionen und Suche.
//
// Regeln:
//   * Ein Auftraggeber OHNE Niederlassungen wird überall unverändert nur mit
//     seinem Namen angezeigt.
//   * Hat er welche, steht überall „Name · Bezeichnung" — auch beim
//     Hauptsitz (Bezeichnung = auftraggeber.hauptsitz_bezeichnung, sonst
//     sein Ort), sonst wäre der Hauptsitz nicht unterscheidbar.
//   * niederlassung_id = null bedeutet Hauptsitz.
//   * Inaktive Niederlassungen werden weiter angezeigt, sind aber nicht
//     mehr auswählbar.
//
// Ist Migration 118 noch nicht eingespielt, verhält sich alles wie vorher
// (keine Niederlassungen, keine neuen Spalten in Abfragen).

import { supabase } from './supabase';
import { cachedQuery, invalidateCachePrefix } from './queryCache';
import type { Database } from '../types/supabase';

export type NiederlassungRow = Database['public']['Tables']['auftraggeber_niederlassungen']['Row'];

/** Auftraggeber-Felder, die für Anzeige und Rechnungs-Vorgaben gebraucht werden. */
export interface AuftraggeberStamm {
  id: string;
  name: string;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land_code?: string | null;
  hauptsitz_bezeichnung?: string | null;
  email1?: string | null;
  erechnung_email?: string | null;
  kaeufer_referenz?: string | null;
  kundennummer?: string | null;
  kontakt?: string | null;
}

export interface Standorte {
  /** Migration 118 eingespielt? */
  aktiv: boolean;
  auftraggeber: AuftraggeberStamm[];
  /** Alle Niederlassungen (auch inaktive), nach Auftraggeber gruppiert. */
  jeAuftraggeber: Map<string, NiederlassungRow[]>;
  /** Niederlassung nach id. */
  nachId: Map<string, NiederlassungRow>;
}

// ---------------------------------------------------------------- Schema

let schemaPromise: Promise<boolean> | null = null;

/** Ist Migration 118 eingespielt? (gecacht; „nein" wird nicht dauerhaft gemerkt) */
export function niederlassungenVorhanden(): Promise<boolean> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const { error } = await supabase.from('auftraggeber_niederlassungen').select('id').limit(1);
      if (!error) return true;
      console.warn('[Niederlassungen] Migration 118 nicht erkannt:', error.message);
      schemaPromise = null;
      return false;
    })();
  }
  return schemaPromise;
}

/** Für Abfragen: „, niederlassung_id" anhängen, sobald Migration 118 da ist. */
export async function mitNiederlassungSpalte(select: string): Promise<string> {
  return (await niederlassungenVorhanden()) ? `${select.trimEnd()}, niederlassung_id` : select;
}

/** Nur für Tests. */
export function _niederlassungenSchemaSetzen(wert: boolean | null): void {
  schemaPromise = wert == null ? null : Promise.resolve(wert);
}

// ---------------------------------------------------------------- Laden

const CACHE_KEY = 'niederlassungen.standorte';
const AG_SPALTEN = 'id, name, strasse, plz, ort, land_code, email1, erechnung_email, kaeufer_referenz, kundennummer, kontakt';

/**
 * Auftraggeber + Niederlassungen laden (30 s Cache). Für Auftraggeber-
 * Konten liefert RLS nur den eigenen Auftraggeber und dessen Standorte.
 */
export function ladeStandorte(): Promise<Standorte> {
  return cachedQuery(CACHE_KEY, async () => {
    const aktiv = await niederlassungenVorhanden();
    const agSel = aktiv ? `${AG_SPALTEN}, hauptsitz_bezeichnung` : AG_SPALTEN;
    const [agRes, nlRes] = await Promise.all([
      supabase.from('auftraggeber').select(agSel).order('name'),
      aktiv
        ? supabase.from('auftraggeber_niederlassungen').select('*').order('bezeichnung')
        : Promise.resolve({ data: [] as NiederlassungRow[], error: null }),
    ]);
    if (agRes.error) throw new Error(agRes.error.message);
    if (nlRes.error) throw new Error(nlRes.error.message);
    const jeAuftraggeber = new Map<string, NiederlassungRow[]>();
    const nachId = new Map<string, NiederlassungRow>();
    for (const n of (nlRes.data ?? []) as NiederlassungRow[]) {
      nachId.set(n.id, n);
      const l = jeAuftraggeber.get(n.auftraggeber_id) ?? [];
      l.push(n);
      jeAuftraggeber.set(n.auftraggeber_id, l);
    }
    const ergebnis = { aktiv, auftraggeber: (agRes.data ?? []) as unknown as AuftraggeberStamm[], jeAuftraggeber, nachId };
    zuletzt = ergebnis;
    return ergebnis;
  });
}

let zuletzt: Standorte | null = null;

/** Bezeichnung einer Niederlassung aus dem zuletzt geladenen Stand (für Protokoll-Texte). */
export function niederlassungBezeichnung(id: string | null | undefined): string | null {
  return (id && zuletzt?.nachId.get(id)?.bezeichnung) || null;
}

/** Nach dem Bearbeiten von Auftraggebern/Niederlassungen aufrufen. */
export function standorteNeuLaden(): void {
  invalidateCachePrefix(CACHE_KEY);
  invalidateCachePrefix('auftraggeber.list');
}

// ---------------------------------------------------------------- Anzeige

/** Bezeichnung des Hauptsitzes: eigene Bezeichnung, sonst Ort, sonst „Hauptsitz". */
export function hauptsitzBezeichnung(ag: Pick<AuftraggeberStamm, 'ort' | 'hauptsitz_bezeichnung'> | null | undefined): string {
  return ag?.hauptsitz_bezeichnung?.trim() || ag?.ort?.trim() || 'Hauptsitz';
}

/** Hat der Auftraggeber mindestens eine (auch inaktive) Niederlassung? */
export function hatNiederlassungen(s: Standorte | null | undefined, auftraggeberId: string | null | undefined): boolean {
  return !!(s && auftraggeberId && (s.jeAuftraggeber.get(auftraggeberId)?.length ?? 0) > 0);
}

/** Nur der Standort-Teil („Bremen"); null, wenn der Auftraggeber keine Niederlassungen hat. */
export function standortTeil(s: Standorte | null | undefined, auftraggeberId: string | null | undefined, niederlassungId: string | null | undefined): string | null {
  if (!s || !auftraggeberId || !hatNiederlassungen(s, auftraggeberId)) return null;
  if (niederlassungId) return s.nachId.get(niederlassungId)?.bezeichnung ?? null;
  return hauptsitzBezeichnung(s.auftraggeber.find((a) => a.id === auftraggeberId));
}

/**
 * Die zentrale Anzeige: „Name" bzw. „Name · Ort".
 * `name` kann übergeben werden, wenn er schon geladen ist (z.B. per Join).
 */
export function auftraggeberAnzeige(
  s: Standorte | null | undefined,
  auftraggeberId: string | null | undefined,
  niederlassungId?: string | null,
  name?: string | null,
): string {
  const agName = name ?? s?.auftraggeber.find((a) => a.id === auftraggeberId)?.name ?? '';
  const teil = standortTeil(s, auftraggeberId, niederlassungId ?? null);
  return teil ? `${agName} · ${teil}` : agName;
}

/**
 * Kurzform für kompakte Karten: lange Standort-Bezeichnungen werden
 * gekürzt („Bremen-Hemelingen" → „Bremen-Hemel…"), bleiben aber erkennbar.
 */
export function auftraggeberAnzeigeKurz(
  s: Standorte | null | undefined, auftraggeberId: string | null | undefined,
  niederlassungId?: string | null, name?: string | null, maxOrt = 14,
): string {
  const agName = name ?? s?.auftraggeber.find((a) => a.id === auftraggeberId)?.name ?? '';
  const teil = standortTeil(s, auftraggeberId, niederlassungId ?? null);
  if (!teil) return agName;
  const kurz = teil.length > maxOrt ? `${teil.slice(0, maxOrt - 1).trimEnd()}…` : teil;
  return `${agName} · ${kurz}`;
}

// ---------------------------------------------------------------- Auswahl

/** Wert einer Standort-Auswahl: „agId" = Hauptsitz, „agId:nlId" = Niederlassung. */
export function standortWert(auftraggeberId: string, niederlassungId: string | null | undefined): string {
  return niederlassungId ? `${auftraggeberId}:${niederlassungId}` : auftraggeberId;
}
export function standortAusWert(wert: string | null | undefined): { auftraggeberId: string | null; niederlassungId: string | null } {
  if (!wert) return { auftraggeberId: null, niederlassungId: null };
  const [a, n] = wert.split(':');
  return { auftraggeberId: a || null, niederlassungId: n || null };
}

export interface StandortOption {
  wert: string;
  auftraggeberId: string;
  niederlassungId: string | null;
  label: string;
  /** Kleingeschriebener Suchtext: Name, Bezeichnung, Ort, PLZ. */
  such: string;
  aktiv: boolean;
}

/**
 * Optionen für Auswahlfelder: je Auftraggeber ohne Niederlassungen eine
 * Option (nur Name), mit Niederlassungen Hauptsitz + jede Niederlassung.
 * Inaktive nur, wenn `inklusiveWert` sie gerade trägt (Anzeige bleibt).
 */
export function standortOptionen(s: Standorte | null | undefined, opts: { inklusiveWert?: string | null; nurAuftraggeber?: string | null } = {}): StandortOption[] {
  if (!s) return [];
  const out: StandortOption[] = [];
  for (const ag of s.auftraggeber) {
    if (opts.nurAuftraggeber && ag.id !== opts.nurAuftraggeber) continue;
    const nls = s.jeAuftraggeber.get(ag.id) ?? [];
    const basis = [ag.name, ag.ort, ag.plz].filter(Boolean).join(' ').toLowerCase();
    if (nls.length === 0) {
      out.push({ wert: ag.id, auftraggeberId: ag.id, niederlassungId: null, label: ag.name, such: basis, aktiv: true });
      continue;
    }
    const hs = hauptsitzBezeichnung(ag);
    out.push({ wert: ag.id, auftraggeberId: ag.id, niederlassungId: null, label: `${ag.name} · ${hs}`,
      such: `${basis} ${hs} hauptsitz`.toLowerCase(), aktiv: true });
    for (const n of nls) {
      const wert = standortWert(ag.id, n.id);
      if (!n.aktiv && wert !== opts.inklusiveWert) continue;
      out.push({
        wert, auftraggeberId: ag.id, niederlassungId: n.id,
        label: `${ag.name} · ${n.bezeichnung}${n.aktiv ? '' : ' (inaktiv)'}`,
        such: [ag.name, n.bezeichnung, n.ort, n.plz, n.strasse].filter(Boolean).join(' ').toLowerCase(),
        aktiv: n.aktiv,
      });
    }
  }
  return out;
}

/** Trifft eine Suche (z.B. „bremen") auf den Standort der Tour? */
export function standortPasstZuSuche(s: Standorte | null | undefined, auftraggeberId: string | null | undefined, niederlassungId: string | null | undefined, suche: string): boolean {
  const q = suche.trim().toLowerCase();
  if (!q || !s || !auftraggeberId) return false;
  if (niederlassungId) {
    const n = s.nachId.get(niederlassungId);
    return !!n && [n.bezeichnung, n.ort, n.plz].filter(Boolean).join(' ').toLowerCase().includes(q);
  }
  if (!hatNiederlassungen(s, auftraggeberId)) return false;
  const ag = s.auftraggeber.find((a) => a.id === auftraggeberId);
  return hauptsitzBezeichnung(ag).toLowerCase().includes(q);
}

/** Niederlassungen, deren Bezeichnung/Ort/PLZ die Suche enthält (für Server-Suchen). */
export function niederlassungenZurSuche(s: Standorte | null | undefined, suche: string): NiederlassungRow[] {
  const q = suche.trim().toLowerCase();
  if (!q || !s) return [];
  return [...s.nachId.values()].filter((n) => [n.bezeichnung, n.ort, n.plz].filter(Boolean).join(' ').toLowerCase().includes(q));
}

// ---------------------------------------------------------------- Filter

/**
 * Filter-Werte für Listen (Tourenliste, Rechnungen …):
 *   ''            alle
 *   'agId'        Auftraggeber mit ALLEN Niederlassungen
 *   'agId:hs'     nur Hauptsitz
 *   'agId:nlId'   nur diese Niederlassung
 */
export function filterPasst(filter: string, auftraggeberId: string | null | undefined, niederlassungId: string | null | undefined): boolean {
  if (!filter) return true;
  const [ag, teil] = filter.split(':');
  if (auftraggeberId !== ag) return false;
  if (!teil) return true;
  if (teil === 'hs') return !niederlassungId;
  return niederlassungId === teil;
}

export interface FilterOption { wert: string; label: string; eingerueckt: boolean }

/** Optionen für den Auftraggeber-Filter: Auftraggeber, darunter ggf. Hauptsitz + Niederlassungen. */
export function filterOptionen(s: Standorte | null | undefined, auftraggeber?: Array<{ id: string; name: string }>): FilterOption[] {
  const liste = auftraggeber ?? s?.auftraggeber ?? [];
  const out: FilterOption[] = [];
  for (const ag of liste) {
    const nls = s?.jeAuftraggeber.get(ag.id) ?? [];
    if (nls.length === 0) { out.push({ wert: ag.id, label: ag.name, eingerueckt: false }); continue; }
    out.push({ wert: ag.id, label: `${ag.name} (alle Standorte)`, eingerueckt: false });
    out.push({ wert: `${ag.id}:hs`, label: `${ag.name} · ${hauptsitzBezeichnung(s?.auftraggeber.find((a) => a.id === ag.id))}`, eingerueckt: true });
    for (const n of nls) out.push({ wert: `${ag.id}:${n.id}`, label: `${ag.name} · ${n.bezeichnung}${n.aktiv ? '' : ' (inaktiv)'}`, eingerueckt: true });
  }
  return out;
}

/** Auftraggeber-Teil eines Filterwerts (für Server-Abfragen auf auftraggeber_id). */
export function filterAuftraggeber(filter: string): string | null {
  return filter ? filter.split(':')[0] || null : null;
}

// ---------------------------------------------------------------- Rechnungs-Vorgaben

export interface RechnungsVorgaben {
  /** Adresse für den Snapshot (Straße, PLZ, Ort, Land). */
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  landCode: string | null;
  /** Rechnungs-E-Mail (Versand), E-Rechnungs-Adresse, Käuferreferenz, Kundennummer, Ansprechpartner. */
  rechnungsEmail: string | null;
  erechnungEmail: string | null;
  kaeuferReferenz: string | null;
  kundennummer: string | null;
  ansprechpartner: string | null;
}

const leer = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * Werte für eine Rechnung an diesen Standort: Adresse der Niederlassung;
 * Rechnungs-E-Mail usw. der Niederlassung, sonst des Auftraggebers.
 * Ohne Niederlassung: die Werte des Auftraggebers (wie bisher).
 */
export function rechnungsVorgaben(ag: AuftraggeberStamm, n: NiederlassungRow | null | undefined): RechnungsVorgaben {
  if (!n) {
    return {
      strasse: leer(ag.strasse), plz: leer(ag.plz), ort: leer(ag.ort), landCode: leer(ag.land_code ?? null),
      rechnungsEmail: leer(ag.email1), erechnungEmail: leer(ag.erechnung_email), kaeuferReferenz: leer(ag.kaeufer_referenz),
      kundennummer: leer(ag.kundennummer), ansprechpartner: leer(ag.kontakt),
    };
  }
  return {
    strasse: leer(n.strasse), plz: leer(n.plz), ort: leer(n.ort), landCode: leer(n.land_code) ?? leer(ag.land_code ?? null),
    rechnungsEmail: leer(n.rechnungs_email) ?? leer(ag.email1),
    erechnungEmail: leer(n.erechnung_email) ?? leer(ag.erechnung_email),
    kaeuferReferenz: leer(n.kaeufer_referenz) ?? leer(ag.kaeufer_referenz),
    kundennummer: leer(n.kundennummer) ?? leer(ag.kundennummer),
    ansprechpartner: leer(n.ansprechpartner) ?? leer(ag.kontakt),
  };
}
