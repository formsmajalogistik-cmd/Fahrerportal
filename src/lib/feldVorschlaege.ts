// Feld-Vorschläge (Autovervollständigung) — Migration 077.
//
// Werte, die in Formularfeldern schon einmal eingetragen wurden, landen
// beim Abschicken im firmenweiten Pool `feld_vorschlaege` und werden beim
// nächsten Ausfüllen angeboten. Gepoolt wird nach `feld_typ`, damit z.B.
// alle Adressfelder aus demselben Topf schöpfen.
//
// Zugriff:
//   * Lesen  — alle Rollen AUSSER Auftraggeber (RLS-Policy `fv_read`).
//   * Schreiben — nur über die RPC `feld_vorschlaege_merken`, die
//     Auftraggeber und Test-Profile wirkungslos durchlaufen lässt.
// Das Frontend verlässt sich NICHT darauf: der Testmodus-Guard verhindert
// den Aufruf zusätzlich schon hier.

import { supabase } from './supabase';
import { normalisiereFuerTyp } from './textNormalisierung';
import type { FormField, FormSchema } from '../types/db';
import type { Json } from '../types/supabase';

export interface FeldVorschlag {
  id: string;
  feld_typ: string;
  wert: string;
  anzahl: number;
  letzte_nutzung: string;
  /** Vom Admin von Hand angelegt (090) — wird zuerst angeboten. */
  ist_manuell: boolean;
}

/** Kürzeste Länge, ab der ein Wert gesammelt wird (auch serverseitig). */
const MIN_LAENGE = 3;
const MAX_LAENGE = 200;

/** Whitespace vereinheitlichen — "Muster  Str." == "Muster Str.". */
export function normalisiereWert(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const wert = raw.trim().replace(/\s+/g, ' ');
  if (wert.length < MIN_LAENGE || wert.length > MAX_LAENGE) return null;
  return wert;
}

// ---- Lesen -------------------------------------------------------
// Pro feld_typ einmal laden und im Modul cachen. Die Liste ändert sich
// erst beim nächsten Absenden, ein Reload pro Session reicht.
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

export async function ladeVorschlaege(feldTyp: string): Promise<string[]> {
  const key = feldTyp.trim();
  if (!key) return [];
  const cached = cache.get(key);
  if (cached) return cached;
  const laufend = inflight.get(key);
  if (laufend) return await laufend;

  const p = (async () => {
    const { data, error } = await supabase
      .from('feld_vorschlaege')
      .select('wert')
      .eq('feld_typ', key)
      // Manuell gepflegte Einträge zuerst — sie sind bewusst gesetzt und
      // meist die "richtige" Schreibweise. Danach die häufigsten, bei
      // Gleichstand die zuletzt genutzten.
      .order('ist_manuell', { ascending: false })
      .order('anzahl', { ascending: false })
      .order('letzte_nutzung', { ascending: false })
      .limit(300);
    if (error) {
      // Auftraggeber bekommen hier per RLS schlicht nichts — kein Fehler.
      console.warn('[feldVorschlaege] Laden fehlgeschlagen', error.message);
      return [];
    }
    const werte = ((data as { wert: string }[]) ?? []).map((r) => r.wert);
    cache.set(key, werte);
    return werte;
  })().finally(() => { inflight.delete(key); });

  inflight.set(key, p);
  return await p;
}

/** Cache verwerfen, damit gerade gespeicherte Werte wieder auftauchen. */
export function resetVorschlagCache(feldTyp?: string): void {
  if (feldTyp) cache.delete(feldTyp.trim());
  else cache.clear();
}

// ---- Sammeln + Speichern ----------------------------------------

export interface VorschlagEintrag { feld_typ: string; wert: string }

/**
 * Feldnamen, die NIE gesammelt werden — auch dann nicht, wenn die
 * Ableitung unten sonst greifen würde.
 *
 * Freitexte (Schäden, Notizen) taugen nicht als Vorschlag, Zahlen wie
 * der Kilometerstand sind pro Fahrt anders, und personenbezogene
 * Fahrerdaten sowie die Führerscheinkontrolle gehören grundsätzlich
 * nicht in einen firmenweiten Pool.
 */
const AUSGESCHLOSSEN = /schaden|schäden|maengel|mängel|beschreib|notiz|bemerkung|kommentar|freitext|kilometer|(^|[^a-z])km([^a-z]|$)|tacho|fuehrerschein|führerschein|fahrername|fahrer_name|unterschrift|signatur|geburt|personal/;

/**
 * Automatische Ableitung des Pool-Schlüssels aus Typ und Feldname.
 *
 * Der frühere reine Opt-in war der Grund, warum der Pool leer blieb:
 * die Option ließ sich zwar im Template-Editor setzen, war bei den
 * produktiv genutzten Templates aber nirgends aktiviert — also gab es
 * nie Kandidaten und damit auch nie einen Fehler.
 *
 * Deshalb gelten die typischen Felder jetzt standardmäßig als
 * vorschlagsfähig. Die Opt-in-Option bleibt bestehen und sticht diese
 * Ableitung in BEIDE Richtungen (gezielt an- oder abschalten).
 *
 * Die Schlüssel sind bewusst dieselben, die ein `address`-Feld über
 * adressTeilTyp() erzeugt — dadurch schöpfen ein zusammengesetztes
 * Adressfeld und einzelne Straßen-/PLZ-/Ort-Textfelder aus demselben
 * Topf.
 */
export function abgeleiteterFeldTyp(field: FormField): string | null {
  if (field.type !== 'text' && field.type !== 'address') return null;
  const s = `${field.id} ${field.label ?? ''}`.toLowerCase();
  if (AUSGESCHLOSSEN.test(s)) return null;
  if (field.type === 'address') return 'adresse';
  if (/mail/.test(s)) return 'email';
  if (/telefon|tel\.|mobil|handy|rufnummer/.test(s)) return 'telefon';
  if (/(^|[^a-z])plz([^a-z]|$)|postleitzahl/.test(s)) return 'adresse_plz';
  if (/stra(ß|ss)e|anschrift|adresse/.test(s)) return 'adresse_strasse';
  if (/(^|[^a-z])ort([^a-z]|$)|stadt|standort/.test(s)) return 'adresse_stadt';
  if (/fahrzeug|modell|marke|hersteller/.test(s)) return 'fahrzeugmodell';
  if (/firma|unternehmen|kunde|händler|haendler/.test(s)) return 'firma';
  if (/kontakt|ansprech|name/.test(s)) return 'kontaktname';
  return null;
}

/**
 * Pool-Schlüssel eines Feldes — oder null, wenn nicht gesammelt wird.
 *
 * Reihenfolge: ausdrückliches Opt-out gewinnt, dann ausdrückliches
 * Opt-in, sonst greift die automatische Ableitung.
 */
export function feldTypVon(field: FormField): string | null {
  // Ausdrücklich abgeschaltet — auch gegen die Ableitung.
  if (field.vorschlaege && field.vorschlaege.enabled === false) return null;
  if (field.vorschlaege?.enabled) {
    const typ = field.vorschlaege.feld_typ?.trim();
    return typ || abgeleiteterFeldTyp(field) || field.id;
  }
  return abgeleiteterFeldTyp(field);
}

/** Unterschlüssel für die drei Teile eines Adressfeldes. */
export function adressTeilTyp(basis: string, teil: 'strasse' | 'plz' | 'stadt'): string {
  return `${basis}_${teil}`;
}

/**
 * Liest aus den Formulardaten alle Werte, die in den Pool gehören.
 * Nur Felder mit aktivierter Vorschlags-Option; PLZ wird bewusst
 * mitgesammelt, weil sie zusammen mit der Stadt nützlich ist.
 */
export function sammleVorschlaege(
  schema: FormSchema,
  daten: Record<string, unknown>,
): VorschlagEintrag[] {
  const out: VorschlagEintrag[] = [];
  const gesehen = new Set<string>();
  const push = (feld_typ: string, raw: unknown) => {
    const roh = normalisiereWert(raw);
    if (!roh) return;
    // Einheitliche Schreibweise, sonst stehen „bremen" und „Bremen"
    // als zwei Einträge im selben Topf (4a).
    const wert = normalisiereFuerTyp(feld_typ, roh);
    const key = `${feld_typ}|${wert.toLowerCase()}`;
    if (gesehen.has(key)) return;
    gesehen.add(key);
    out.push({ feld_typ, wert });
  };

  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      const basis = feldTypVon(field);
      if (!basis) continue;
      const value = daten[field.id];
      if (field.type === 'address') {
        if (!value || typeof value !== 'object') continue;
        const a = value as Record<string, unknown>;
        push(adressTeilTyp(basis, 'strasse'), a.strasse);
        push(adressTeilTyp(basis, 'plz'), a.plz);
        push(adressTeilTyp(basis, 'stadt'), a.stadt);
      } else if (field.type === 'text') {
        push(basis, value);
      }
    }
  }
  return out;
}

/**
 * Schreibt die gesammelten Werte in den Pool. Fehler sind nicht kritisch
 * — das Formular ist zu diesem Zeitpunkt bereits eingereicht.
 */
export async function merkeVorschlaege(eintraege: VorschlagEintrag[]): Promise<void> {
  // Diagnose: bleibt bewusst drin. Genau hier war der Pool wochenlang
  // still leer — ohne Kandidaten gibt es keinen Fehler, also auch kein
  // Signal. Die Zeile macht den Leerfall sichtbar.
  console.log('[Vorschläge] Kandidaten', eintraege);
  if (eintraege.length === 0) {
    console.warn(
      '[Vorschläge] Keine Kandidaten — kein Feld dieses Formulars ist '
      + 'vorschlagsfähig (weder abgeleitet noch per Opt-in).',
    );
    return;
  }
  try {
    const { data, error } = await supabase.rpc('feld_vorschlaege_merken', {
      p_eintraege: eintraege as unknown as Json,
    });
    console.log('[Vorschläge] Upsert-Ergebnis', {
      gespeichert: data, error: error?.message ?? null,
    });
    if (error) {
      console.warn('[feldVorschlaege] Speichern fehlgeschlagen', error.message);
      return;
    }
    // Cache der betroffenen Töpfe verwerfen, damit der neue Wert beim
    // nächsten Formular sofort auftaucht.
    for (const e of eintraege) resetVorschlagCache(e.feld_typ);
  } catch (err) {
    console.warn('[feldVorschlaege] Speichern warf', err);
  }
}

/**
 * Bequemer Aufruf aus den Formular-Seiten: sammelt und speichert in
 * einem Rutsch. `istTest` unterdrückt das Speichern schon im Client.
 */
export async function merkeAusFormular(
  schema: FormSchema,
  daten: Record<string, unknown>,
  istTest: boolean,
): Promise<void> {
  if (istTest) return;
  await merkeVorschlaege(sammleVorschlaege(schema, daten));
}

// ---- Pflege (Admin) ---------------------------------------------

export async function ladeAlleVorschlaege(): Promise<FeldVorschlag[]> {
  const { data, error } = await supabase
    .from('feld_vorschlaege')
    .select('id, feld_typ, wert, anzahl, letzte_nutzung, ist_manuell')
    .order('feld_typ', { ascending: true })
    .order('ist_manuell', { ascending: false })
    .order('anzahl', { ascending: false })
    .order('letzte_nutzung', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as FeldVorschlag[]) ?? [];
}

export async function loescheVorschlag(id: string): Promise<void> {
  const { error } = await supabase.from('feld_vorschlaege').delete().eq('id', id);
  if (error) throw new Error(error.message);
  resetVorschlagCache();
}

/** Manuellen Eintrag anlegen (Admin — RLS erzwingt das). */
export async function legeVorschlagAn(
  feldTyp: string, wert: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const roh = normalisiereWert(wert);
  const t = feldTyp.trim();
  if (!t || !roh) return { ok: false, fehler: 'Topf und Wert (mind. 3 Zeichen) sind erforderlich.' };
  // Gleiche Normalisierung wie beim Sammeln — ein manueller Eintrag soll
  // nicht als eigene Schreibweise neben den gesammelten stehen.
  const w = normalisiereFuerTyp(t, roh);
  const { error } = await supabase.from('feld_vorschlaege').insert({
    feld_typ: t, wert: w, ist_manuell: true,
  });
  if (error) return { ok: false, fehler: error.message };
  resetVorschlagCache(t);
  return { ok: true };
}

/** Wert korrigieren (Tippfehler). */
export async function aktualisiereVorschlag(
  id: string, wert: string, feldTyp?: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const roh = normalisiereWert(wert);
  if (!roh) return { ok: false, fehler: 'Wert muss mindestens 3 Zeichen haben.' };
  const w = feldTyp ? normalisiereFuerTyp(feldTyp, roh) : roh;
  const { error } = await supabase
    .from('feld_vorschlaege').update({ wert: w }).eq('id', id);
  if (error) return { ok: false, fehler: error.message };
  resetVorschlagCache();
  return { ok: true };
}

/**
 * Adressteile einer Tour in den Pool übernehmen (4b).
 *
 * Bis hierher speiste ausschließlich das Absenden eines Formulars den
 * Pool. Adressen werden aber vor allem in der Tour-Maske gepflegt —
 * deshalb bleiben Straßen dort selten und Städte häufig, wenn nur die
 * Formulare sammeln. Die Töpfe sind dieselben wie bei den
 * Formular-Adressfeldern, damit beide Seiten voneinander profitieren.
 *
 * Serverseitig läuft der Aufruf für Auftraggeber- und Test-Konten
 * wirkungslos durch (RPC aus Migration 077) — der Pool bleibt für sie
 * unerreichbar, ohne dass hier gefiltert werden müsste.
 */
export async function merkeTourAdressen(
  stationen: Array<{ strasse?: string | null; plz?: string | null; stadt?: string | null }>,
  istTest: boolean,
): Promise<void> {
  if (istTest) return;
  const eintraege: VorschlagEintrag[] = [];
  const gesehen = new Set<string>();
  const push = (feld_typ: string, raw: unknown) => {
    const roh = normalisiereWert(raw);
    if (!roh) return;
    const wert = normalisiereFuerTyp(feld_typ, roh);
    const key = `${feld_typ}|${wert.toLowerCase()}`;
    if (gesehen.has(key)) return;
    gesehen.add(key);
    eintraege.push({ feld_typ, wert });
  };
  for (const s of stationen) {
    push('adresse_strasse', s.strasse);
    push('adresse_plz', s.plz);
    push('adresse_stadt', s.stadt);
  }
  if (eintraege.length === 0) return;
  await merkeVorschlaege(eintraege);
}

// ---- Bestandsbereinigung (Migration 094) -------------------------

export interface PoolStatus {
  eintraegeGesamt: number;
  offenSchreibweise: number;
  duplikatGruppen: number;
  duplikatUeberzaehlig: number;
  adressbuchOffen: number;
  /** Summe aller offenen Posten — 0 = nichts zu tun. */
  offen: number;
}

interface StatusRow {
  eintraege_gesamt: number;
  offen_schreibweise: number;
  duplikat_gruppen: number;
  duplikat_ueberzaehlig: number;
  adressbuch_offen: number;
}

function alsStatus(r: StatusRow | null): PoolStatus | null {
  if (!r) return null;
  return {
    eintraegeGesamt: r.eintraege_gesamt ?? 0,
    offenSchreibweise: r.offen_schreibweise ?? 0,
    duplikatGruppen: r.duplikat_gruppen ?? 0,
    duplikatUeberzaehlig: r.duplikat_ueberzaehlig ?? 0,
    adressbuchOffen: r.adressbuch_offen ?? 0,
    offen: (r.offen_schreibweise ?? 0)
      + (r.duplikat_ueberzaehlig ?? 0)
      + (r.adressbuch_offen ?? 0),
  };
}

/** Zustand des Pools — Grundlage für die Fortschrittsanzeige. */
export async function ladePoolStatus(): Promise<PoolStatus | null> {
  const { data, error } = await supabase.rpc('adress_pool_status');
  if (error) {
    console.warn('[feldVorschlaege] Status fehlgeschlagen', error.message);
    return null;
  }
  const rows = (data as StatusRow[] | null) ?? [];
  return alsStatus(rows[0] ?? null);
}

export interface BereinigungsSchritt {
  zusammengefuehrt: number;
  umbenannt: number;
  adressbuch: number;
  /** Nach diesem Block noch offen. 0 = fertig. */
  offen: number;
}

/**
 * Ein Block der Bestandsbereinigung.
 *
 * Bewusst blockweise statt in einem Rutsch: der ursprüngliche
 * Gesamtdurchlauf lief im SQL-Editor in einen Verbindungs-Timeout.
 * Jeder Aufruf hier bleibt kurz; die Oberfläche wiederholt ihn, bis
 * `offen` 0 meldet.
 */
export async function bereinigePoolBlock(limit = 500): Promise<BereinigungsSchritt> {
  const { data, error } = await supabase.rpc('adress_pool_bereinigen', { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data as BereinigungsSchritt[] | null) ?? [];
  const r = rows[0];
  if (!r) throw new Error('Keine Antwort von der Bereinigung erhalten.');
  resetVorschlagCache();
  return {
    zusammengefuehrt: r.zusammengefuehrt ?? 0,
    umbenannt: r.umbenannt ?? 0,
    adressbuch: r.adressbuch ?? 0,
    offen: r.offen ?? 0,
  };
}
