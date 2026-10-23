// Auslagen (Wartezeit, Ladezeit, Rote Kennzeichen …) automatisch bepreisen.
//
// Die Preise stehen je Auftraggeber in `sonderverguetungen` (Migration 011,
// erweitert in 109 um zusatz_kategorie, abrechnung, freiminuten). Lesen
// dürfen sie nur Admins. Hier steht nur die Rechnung — ohne Supabase, damit
// sie für sich prüfbar ist. Genutzt von beiden Zusatz-Erfassungen (Tour-
// Detail und Posteingang) über lib/useAuslagenAutomatik.
//
// Der Preis gilt immer JE EINHEIT. Beispiel Wartezeit 30 € „je angefangene
// Stunde", 30 Freiminuten:
//   1:10 h → 70 − 30 = 40 Min → 1 angefangene Stunde → 1 × 30 € = 30 €
//   1:40 h → 100 − 30 = 70 Min → 2 angefangene Stunden → 2 × 30 € = 60 €

import { formatEuro } from './touren';

export type Abrechnung =
  | 'pauschal' | 'stunde' | 'angefangene_stunde' | 'angefangene_30' | 'angefangene_15' | 'tag' | 'stueck';

export const ABRECHNUNG_LABEL: Record<Abrechnung, string> = {
  pauschal: 'pauschal',
  stunde: 'je Stunde (genau)',
  angefangene_stunde: 'je angefangene Stunde',
  angefangene_30: 'je angefangene 30 Min',
  angefangene_15: 'je angefangene 15 Min',
  tag: 'je Tag',
  stueck: 'je Stück',
};

export const ABRECHNUNGEN = Object.keys(ABRECHNUNG_LABEL) as Abrechnung[];

export interface AuslagenRegel {
  kategorie: string;
  bezeichnung: string;
  preis: number;
  abrechnung: Abrechnung;
  freiminuten: number;
}

export function istZeitbasiert(a: Abrechnung | null | undefined): boolean {
  return a === 'stunde' || a === 'angefangene_stunde' || a === 'angefangene_30' || a === 'angefangene_15';
}

const TAKT: Partial<Record<Abrechnung, number>> = { angefangene_stunde: 60, angefangene_30: 30, angefangene_15: 15 };

/** Gleiche Kategorie trotz Schreibweise („wartezeit ", „Wartezeit"). */
export function kategorieSchluessel(k: string | null | undefined): string {
  return (k ?? '').trim().toLowerCase();
}

/**
 * Dauer-Eingabe → Minuten. Erlaubt „1:10", „1:10 h", „2" (Stunden),
 * „1,5" bzw. „1.5" (Stunden), „90 min". Leer/ungültig/mehrdeutig → null.
 */
export function parseDauer(text: string | null | undefined): number | null {
  const t = (text ?? '').trim().toLowerCase().replace(/\s*h$/, '').replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,4})\s?min$/.exec(t);
  if (m) return Number(m[1]);
  // Dezimal nur mit EINER Nachkommastelle („1,5" = 1:30). „1,50" wäre
  // mehrdeutig (1,5 h oder 1:50?) → ablehnen, dann bitte h:mm.
  m = /^(\d{1,3})(?:[.,](\d))?$/.exec(t);
  if (m) return Math.round((Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0)) * 60);
  return null;
}

export function formatDauer(min: number): string {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  return `${h}:${mm} h`;
}

export type AuslagenErgebnis =
  | { ok: true; anzahl: number; einzelpreis: number; gesamt: number; erklaerung: string }
  | { ok: false; grund: 'dauer_fehlt' | 'menge_ungueltig'; text: string };

const runde2 = (n: number) => Math.round(n * 100) / 100;

export function berechneAuslage(
  regel: AuslagenRegel,
  eingabe: { dauerMin?: number | null; menge?: number | null },
): AuslagenErgebnis {
  const preis = runde2(regel.preis);
  if (istZeitbasiert(regel.abrechnung)) {
    if (eingabe.dauerMin == null || !Number.isFinite(eingabe.dauerMin) || eingabe.dauerMin < 0) {
      return { ok: false, grund: 'dauer_fehlt', text: 'Bitte die Dauer eintragen (z.B. 1:10).' };
    }
    const frei = Math.max(0, regel.freiminuten || 0);
    const abrechenbar = Math.max(0, eingabe.dauerMin - frei);
    const freiText = frei > 0 ? `${formatDauer(eingabe.dauerMin)} − ${frei} Min frei = ${abrechenbar} Min` : `${formatDauer(eingabe.dauerMin)}`;
    if (abrechenbar === 0) {
      return { ok: true, anzahl: 0, einzelpreis: preis, gesamt: 0, erklaerung: `${freiText} → innerhalb der Freiminuten, kein Betrag` };
    }
    if (regel.abrechnung === 'stunde') {
      const anzahl = runde2(abrechenbar / 60);
      return { ok: true, anzahl, einzelpreis: preis, gesamt: runde2(anzahl * preis), erklaerung: `${freiText} → ${anzahl.toLocaleString('de-DE')} h × ${formatEuro(preis)}` };
    }
    const takt = TAKT[regel.abrechnung]!;
    const anzahl = Math.ceil(abrechenbar / takt);
    const einheit = takt === 60 ? (anzahl === 1 ? 'angefangene Stunde' : 'angefangene Stunden') : `× ${takt} Min (angefangen)`;
    return { ok: true, anzahl, einzelpreis: preis, gesamt: runde2(anzahl * preis), erklaerung: `${freiText} → ${anzahl} ${einheit} × ${formatEuro(preis)}` };
  }
  const menge = eingabe.menge ?? 1;
  if (!Number.isFinite(menge) || menge <= 0) return { ok: false, grund: 'menge_ungueltig', text: 'Anzahl ist ungültig.' };
  const was = regel.abrechnung === 'tag' ? (menge === 1 ? 'Tag' : 'Tage') : regel.abrechnung === 'stueck' ? 'Stück' : 'pauschal';
  return {
    ok: true, anzahl: menge, einzelpreis: preis, gesamt: runde2(menge * preis),
    erklaerung: regel.abrechnung === 'pauschal' && menge === 1 ? `pauschal ${formatEuro(preis)}` : `${menge.toLocaleString('de-DE')} ${was} × ${formatEuro(preis)}`,
  };
}

/** Zeile aus sonderverguetungen → Regel (nur vollständig konfigurierte). */
export function regelAusZeile(z: {
  bezeichnung: string; preis: number | string | null; zusatz_kategorie?: string | null;
  abrechnung?: string | null; freiminuten?: number | null;
}): AuslagenRegel | null {
  if (!z.zusatz_kategorie?.trim() || !z.abrechnung || !(ABRECHNUNGEN as string[]).includes(z.abrechnung)) return null;
  const preis = Number(z.preis);
  if (!Number.isFinite(preis) || preis <= 0) return null;
  return {
    kategorie: z.zusatz_kategorie.trim(), bezeichnung: z.bezeichnung, preis,
    abrechnung: z.abrechnung as Abrechnung, freiminuten: Math.max(0, Number(z.freiminuten ?? 0)),
  };
}

/** Euro-Betrag für ein Eingabefeld („30,00"). */
export function betragText(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** Kategorien, für die eine Preisliste erwartet wird (Hinweis „kein Preis hinterlegt"). */
export const PREISLISTEN_KATEGORIEN = ['Wartezeit', 'Ladezeit', 'Rote Kennzeichen', 'Reifenhandling'];

export interface ZusatzFuerAnpassung {
  id: string;
  kategorie: string;
  betrag: number;
  anzahl: number | null;
  dauer_min?: number | null;
  preis_quelle?: string | null;
}

export interface AnpassungsVorschlag {
  id: string;
  kategorie: string;
  alt: { betrag: number; anzahl: number };
  neu: { betrag: number; anzahl: number };
}

/**
 * Auftraggeber der Tour geändert: welche Zusätze würden sich nach der
 * neuen Preisliste ändern? Manuell gesetzte Preise bleiben außen vor —
 * und angewendet wird nur nach Rückfrage (nie still).
 */
export function auslagenAnpassungVorschlagen(
  zusaetze: ZusatzFuerAnpassung[],
  regeln: Map<string, AuslagenRegel>,
): AnpassungsVorschlag[] {
  const out: AnpassungsVorschlag[] = [];
  for (const z of zusaetze) {
    if (z.preis_quelle === 'manuell') continue;
    const r = regeln.get(kategorieSchluessel(z.kategorie));
    if (!r) continue;
    const altAnzahl = Number(z.anzahl ?? 1);
    let anzahl = altAnzahl;
    if (istZeitbasiert(r.abrechnung) && z.dauer_min != null) {
      const e = berechneAuslage(r, { dauerMin: z.dauer_min });
      if (e.ok) anzahl = e.anzahl;
    }
    const betrag = runde2(r.preis);
    if (betrag === runde2(Number(z.betrag)) && anzahl === altAnzahl) continue;
    out.push({ id: z.id, kategorie: z.kategorie, alt: { betrag: Number(z.betrag), anzahl: altAnzahl }, neu: { betrag, anzahl } });
  }
  return out;
}
