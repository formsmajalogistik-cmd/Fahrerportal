// Versandstatus von Rechnungen und Gutschriften (Migration 111).
//
// Der Verlauf liegt in beleg_versand; hier wird daraus der Status je
// Beleg abgeleitet — rein, ohne Supabase, damit testbar:
//   * letzter erfolgreicher Eintrag (App-Versand oder manuelle Markierung)
//     → „Versendet (App)" bzw. „Als versendet markiert"
//   * sonst ein Fehlversuch → „Versand fehlgeschlagen"
//   * sonst „Nicht versendet" — aber nur für Belege, die verschickt
//     werden sollen: Entwürfe und stornierte Rechnungen bekommen keinen
//     Warnhinweis.
// Dazu der exakte Nummern-Abgleich für den Probelauf mit den „Gesendeten
// Elementen": „Re_26/100" trifft NICHT „Re_26/1000".

import { supabase } from './supabase';
import { formatDate, formatDateTime } from './touren';
import { sicheresPfadSegment } from './onedrivePaths';
import type { Database } from '../types/supabase';

export type BelegTyp = 'rechnung' | 'gutschrift';
export type VersandEintrag = Database['public']['Tables']['beleg_versand']['Row'];
export type VersandWeg = VersandEintrag['weg'];

export const WEG_LABEL: Record<VersandWeg, string> = {
  app: 'per E-Mail über die App',
  post: 'Post',
  email_eigen: 'eigene E-Mail',
  kundenportal: 'Kundenportal',
  persoenlich: 'persönlich übergeben',
  sonstiges: 'sonstiges',
  rueckwirkend: 'rückwirkend markiert',
};

/** Wege, die man im Dialog „Als versendet markieren" wählen kann. */
export const MANUELLE_WEGE: VersandWeg[] = ['post', 'email_eigen', 'kundenportal', 'persoenlich', 'sonstiges'];

export type VersandStatusArt = 'app' | 'manuell' | 'fehlgeschlagen' | 'nicht_versendet' | 'ohne';

export interface VersandStatus {
  art: VersandStatusArt;
  /** Letzter erfolgreicher Eintrag (app/manuell). */
  letzter: VersandEintrag | null;
  /** Letzter Fehlversuch, falls NACH dem letzten Erfolg (oder ohne Erfolg). */
  fehlerDanach: VersandEintrag | null;
  /** Alle Einträge (inkl. entfernter), neueste zuerst. */
  verlauf: VersandEintrag[];
}

/** Bekommt dieser Beleg überhaupt einen Versand-Hinweis? */
export function versandRelevant(typ: BelegTyp, status: string | null | undefined): boolean {
  return typ === 'rechnung' ? status === 'offen' || status === 'bezahlt' : status === 'final';
}

function zeitSchluessel(e: VersandEintrag): string {
  return `${e.zeitpunkt ?? `${e.datum}T12:00:00`}|${e.created_at}`;
}

export function versandStatus(
  typ: BelegTyp, belegStatus: string | null | undefined, eintraege: VersandEintrag[],
): VersandStatus {
  const verlauf = [...eintraege].sort((a, b) => zeitSchluessel(b).localeCompare(zeitSchluessel(a)));
  const aktiv = verlauf.filter((e) => !e.entfernt_am);
  const letzter = aktiv.find((e) => e.art === 'app' || e.art === 'manuell') ?? null;
  const letzterFehler = aktiv.find((e) => e.art === 'fehlgeschlagen') ?? null;
  const fehlerDanach = letzterFehler && (!letzter || zeitSchluessel(letzterFehler) > zeitSchluessel(letzter))
    ? letzterFehler : null;
  let art: VersandStatusArt;
  if (letzter) art = letzter.art === 'app' ? 'app' : 'manuell';
  else if (letzterFehler) art = 'fehlgeschlagen';
  else art = versandRelevant(typ, belegStatus) ? 'nicht_versendet' : 'ohne';
  return { art, letzter, fehlerDanach, verlauf };
}

export function eintragZeit(e: VersandEintrag): string {
  return e.zeitpunkt ? formatDateTime(e.zeitpunkt) : formatDate(e.datum);
}

/** Kurztext für Tooltip/Detail: wann, wie, an wen, von wem. */
export function eintragBeschreibung(e: VersandEintrag): string {
  const teile: string[] = [];
  if (e.art === 'fehlgeschlagen') teile.push(`Versand fehlgeschlagen am ${eintragZeit(e)}`);
  else if (e.art === 'app') teile.push(`Versendet (App) am ${eintragZeit(e)}`);
  else teile.push(`Als versendet markiert: ${WEG_LABEL[e.weg]}, ${eintragZeit(e)}`);
  if (e.empfaenger.length > 0) teile.push(`an ${e.empfaenger.join(', ')}`);
  if (e.notiz) teile.push(e.notiz);
  if (e.fehler) teile.push(e.fehler);
  if (e.erstellt_von_name && e.quelle !== 'app') teile.push(`von ${e.erstellt_von_name}`);
  return teile.join(' · ');
}

export function statusTooltip(s: VersandStatus): string {
  if (s.art === 'nicht_versendet') return 'Noch kein Versand bekannt';
  if (s.art === 'ohne') return 'Entwurf/storniert — kein Versand erwartet';
  const teile = [s.letzter ? eintragBeschreibung(s.letzter) : '', s.fehlerDanach ? `Danach: ${eintragBeschreibung(s.fehlerDanach)}` : '']
    .filter(Boolean);
  if (!s.letzter && s.fehlerDanach) return eintragBeschreibung(s.fehlerDanach);
  return teile.join('\n');
}

// ---- Laden / Schreiben ------------------------------------------------

/** Versand-Verlauf je Beleg-ID. Ohne Migration 111: leere Map + fehlt=true. */
export async function ladeVersand(typ: BelegTyp, ids?: string[]): Promise<{ map: Map<string, VersandEintrag[]>; fehlt: boolean }> {
  const spalte = typ === 'rechnung' ? 'rechnung_id' : 'gutschrift_id';
  const map = new Map<string, VersandEintrag[]>();
  const bloecke = ids ? Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150)) : [null];
  for (const b of bloecke) {
    if (b && b.length === 0) continue;
    for (let von = 0; ; von += 1000) {
      let q = supabase.from('beleg_versand').select('*').not(spalte, 'is', null);
      if (b) q = q.in(spalte, b);
      const { data, error } = await q.order('created_at', { ascending: true }).range(von, von + 999);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205' || /beleg_versand/.test(error.message)) return { map, fehlt: true };
        throw new Error(error.message);
      }
      for (const e of (data ?? []) as VersandEintrag[]) {
        const id = (typ === 'rechnung' ? e.rechnung_id : e.gutschrift_id)!;
        map.set(id, [...(map.get(id) ?? []), e]);
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  return { map, fehlt: false };
}

export async function alsVersendetMarkieren(
  typ: BelegTyp, ids: string[], weg: VersandWeg, datum: string, notiz: string,
): Promise<{ markiert: number; uebersprungen: Array<{ id: string; nummer: string; grund: string }> }> {
  const { data, error } = await supabase.rpc('beleg_versand_markieren', {
    p_typ: typ, p_ids: ids, p_weg: weg, p_datum: datum, p_notiz: notiz.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { markiert: number; uebersprungen: Array<{ id: string; nummer: string; grund: string }> };
}

export async function markierungEntfernen(versandId: string): Promise<void> {
  const { error } = await supabase.rpc('beleg_versand_entfernen', { p_versand_id: versandId });
  if (error) throw new Error(error.message);
}

// ---- Probelauf: exakter Nummern-Abgleich ------------------------------

interface Variante { nummer: string; text: string }

/**
 * Index für findeNummern: jede Belegnummer in zwei Schreibweisen — wie
 * sie ist („Re_26/1000", Betreff) und als Dateiname („Re_26_1000",
 * Anhang). Schlüssel ist die laufende Zahl am Ende.
 */
export function nummernIndex(nummern: string[]): Map<string, Variante[]> {
  const idx = new Map<string, Variante[]>();
  for (const n of nummern) {
    for (const text of new Set([n.trim(), sicheresPfadSegment(n.trim(), '')])) {
      const m = /(\d+)$/.exec(text);
      if (!m || !text) continue;
      idx.set(m[1], [...(idx.get(m[1]) ?? []), { nummer: n, text: text.toLowerCase() }]);
    }
  }
  return idx;
}

const ALNUM = /[0-9a-z]/i;

/**
 * Welche Belegnummern kommen in `text` EXAKT vor? Grenze vorn: kein
 * Buchstabe/keine Ziffer davor; hinten: keine Ziffer/kein Buchstabe
 * danach — „Re_26/100" trifft also nicht „Re_26/1000" und nicht
 * „XRe_26/100".
 */
export function findeNummern(text: string, index: Map<string, Variante[]>): string[] {
  const treffer = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/\d+/g)) {
    const ende = (m.index ?? 0) + m[0].length;
    if (ende < lower.length && ALNUM.test(lower[ende])) continue;
    for (const v of index.get(m[0]) ?? []) {
      const start = ende - v.text.length;
      if (start < 0 || lower.slice(start, ende) !== v.text) continue;
      if (start > 0 && ALNUM.test(lower[start - 1])) continue;
      treffer.add(v.nummer);
    }
  }
  return [...treffer];
}

export interface ProbelaufBeleg { id: string; nummer: string; datum: string; status: string; email_versendet_am: string | null }

export interface ProbelaufErgebnis {
  ausDatenbank: Array<ProbelaufBeleg & { zeitpunkt: string }>;
  ausPostfach: Array<ProbelaufBeleg & { zeitpunkt: string; empfaenger: string[]; betreff: string }>;
  schonMitStatus: ProbelaufBeleg[];
  nichtVersendet: ProbelaufBeleg[];
  ohneHinweis: ProbelaufBeleg[];
}

/**
 * Probelauf (schreibt nichts): ordnet jeden Beleg ohne erfolgreichen
 * Versand-Eintrag einer Quelle zu — gespeichertes Versanddatum aus der
 * App, sonst eine passende Mail in „Gesendete Elemente", sonst „Nicht
 * versendet". Entwürfe/stornierte Rechnungen landen in ohneHinweis.
 */
export function probelauf(
  typ: BelegTyp,
  belege: ProbelaufBeleg[],
  versand: Map<string, VersandEintrag[]>,
  mails: Array<{ subject: string; sentDateTime: string; to: string[]; attachments: string[] }>,
): ProbelaufErgebnis {
  const erg: ProbelaufErgebnis = { ausDatenbank: [], ausPostfach: [], schonMitStatus: [], nichtVersendet: [], ohneHinweis: [] };
  const index = nummernIndex(belege.map((b) => b.nummer));
  // Erste (älteste) Mail je Nummer.
  const mailJeNummer = new Map<string, { zeitpunkt: string; empfaenger: string[]; betreff: string }>();
  for (const m of [...mails].sort((a, b) => a.sentDateTime.localeCompare(b.sentDateTime))) {
    for (const n of findeNummern([m.subject, ...m.attachments].join('\n'), index)) {
      if (!mailJeNummer.has(n)) mailJeNummer.set(n, { zeitpunkt: m.sentDateTime, empfaenger: m.to, betreff: m.subject });
    }
  }
  for (const b of belege) {
    const s = versandStatus(typ, b.status, versand.get(b.id) ?? []);
    if (s.letzter) { erg.schonMitStatus.push(b); continue; }
    if (!versandRelevant(typ, b.status)) { erg.ohneHinweis.push(b); continue; }
    if (b.email_versendet_am) { erg.ausDatenbank.push({ ...b, zeitpunkt: b.email_versendet_am }); continue; }
    const m = mailJeNummer.get(b.nummer);
    if (m) { erg.ausPostfach.push({ ...b, ...m }); continue; }
    erg.nichtVersendet.push(b);
  }
  return erg;
}

/** Datum (YYYY-MM-DD) eines ISO-Zeitpunkts in deutscher Zeit. */
export function berlinDatum(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

export async function probelaufUebernehmen(typ: BelegTyp, erg: ProbelaufErgebnis): Promise<{ uebernommen: number; uebersprungen: number }> {
  const eintraege = [
    ...erg.ausDatenbank.map((b) => ({ typ, id: b.id, datum: berlinDatum(b.zeitpunkt), zeitpunkt: b.zeitpunkt, quelle: 'import_datenbank' })),
    ...erg.ausPostfach.map((b) => ({
      typ, id: b.id, datum: berlinDatum(b.zeitpunkt), zeitpunkt: b.zeitpunkt,
      empfaenger: b.empfaenger, betreff: b.betreff, quelle: 'import_postfach',
    })),
  ];
  let uebernommen = 0; let uebersprungen = 0;
  for (let i = 0; i < eintraege.length; i += 200) {
    const { data, error } = await supabase.rpc('beleg_versand_import', { p_eintraege: eintraege.slice(i, i + 200) as never });
    if (error) throw new Error(error.message);
    const d = data as unknown as { uebernommen: number; uebersprungen: number };
    uebernommen += d.uebernommen; uebersprungen += d.uebersprungen;
  }
  return { uebernommen, uebersprungen };
}
