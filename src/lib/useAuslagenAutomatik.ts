// Automatische Auslagen-Preise bei der Zusatz-Erfassung — gemeinsam für
// Tour-Detail und Posteingang („Zusätze + Belege"), damit die Regel nur
// einmal existiert. Rechnung: lib/auslagenPreis.
//
//   * Kategorie gewählt → Einzelpreis aus der Preisliste des Auftraggebers
//   * Dauer/Menge ändert sich → Anzahl neu (Freiminuten, angefangene Takte)
//   * Preis von Hand geändert → bleibt, Hinweis „manuell geändert";
//     „Preisliste übernehmen" setzt zurück
//   * kein Preis hinterlegt / kein Auftraggeber → keine Automatik, Hinweis

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import {
  berechneAuslage, betragText, istZeitbasiert, kategorieSchluessel, parseDauer, regelAusZeile,
  type AuslagenErgebnis, type AuslagenRegel,
} from './auslagenPreis';

interface SvZeile {
  bezeichnung: string; preis: number; zusatz_kategorie: string | null; abrechnung: string | null; freiminuten: number | null;
}
interface Preisliste {
  regeln: Map<string, AuslagenRegel>;
  /** Bezeichnungen ohne Automatik-Angaben — für den Hinweis „Abrechnung fehlt". */
  ohneAbrechnung: Set<string>;
}

// Kurz zwischengespeichert; eine in einem anderen Tab geänderte Preisliste
// greift spätestens nach CACHE_MS.
const CACHE_MS = 60_000;
const cache = new Map<string, { zeit: number; p: Promise<Preisliste> }>();

/** Auslagen-Preise eines Auftraggebers (nur Admins dürfen sie lesen). */
export function ladeAuslagenPreise(auftraggeberId: string): Promise<Preisliste> {
  const treffer = cache.get(auftraggeberId);
  let p = treffer && Date.now() - treffer.zeit < CACHE_MS ? treffer.p : undefined;
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.from('sonderverguetungen')
        .select('bezeichnung, preis, zusatz_kategorie, abrechnung, freiminuten')
        .eq('auftraggeber_id', auftraggeberId);
      const regeln = new Map<string, AuslagenRegel>();
      const ohneAbrechnung = new Set<string>();
      if (error) { cache.delete(auftraggeberId); return { regeln, ohneAbrechnung }; }
      for (const z of (data as unknown as SvZeile[]) ?? []) {
        const r = regelAusZeile(z);
        if (r) regeln.set(kategorieSchluessel(r.kategorie), r);
        else ohneAbrechnung.add(kategorieSchluessel(z.zusatz_kategorie || z.bezeichnung));
      }
      return { regeln, ohneAbrechnung };
    })();
    cache.set(auftraggeberId, { zeit: Date.now(), p });
  }
  return p;
}

/** Nach Änderungen in der Preisliste neu laden. */
export function auslagenPreiseVergessen(auftraggeberId?: string): void {
  if (auftraggeberId) cache.delete(auftraggeberId); else cache.clear();
}

function parseZahl(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

export function useAuslagenAutomatik(args: {
  auftraggeberId: string | null | undefined;
  kategorie: string;
  mengeText: string;
  dauerText: string;
}) {
  const { auftraggeberId, kategorie, mengeText, dauerText } = args;
  const [liste, setListe] = useState<Preisliste | null>(null);
  const [betrag, setBetragRoh] = useState('');
  const [manuell, setManuell] = useState(false);

  useEffect(() => {
    let weg = false;
    if (!auftraggeberId) { queueMicrotask(() => { if (!weg) setListe(null); }); return () => { weg = true; }; }
    void ladeAuslagenPreise(auftraggeberId).then((l) => { if (!weg) setListe(l); });
    return () => { weg = true; };
  }, [auftraggeberId]);

  const regel = useMemo(
    () => (liste && kategorie ? liste.regeln.get(kategorieSchluessel(kategorie)) ?? null : null),
    [liste, kategorie],
  );
  const zeitbasiert = istZeitbasiert(regel?.abrechnung);
  const dauerMin = parseDauer(dauerText);
  const ergebnis: AuslagenErgebnis | null = useMemo(
    () => (regel ? berechneAuslage(regel, { dauerMin, menge: parseZahl(mengeText) ?? 1 }) : null),
    [regel, dauerMin, mengeText],
  );

  // Kategorie/Auftraggeber gewechselt → Preisliste wieder maßgeblich.
  useEffect(() => {
    queueMicrotask(() => {
      setManuell(false);
      setBetragRoh((alt) => (regel ? betragText(regel.preis) : (alt && liste ? '' : alt)));
    });
  }, [regel, liste]);

  /** Eingabe im Preisfeld: weicht sie von der Preisliste ab → „manuell". */
  const setBetrag = useCallback((v: string) => {
    setBetragRoh(v);
    if (regel) {
      const n = parseZahl(v);
      setManuell(n == null || Math.round(n * 100) !== Math.round(regel.preis * 100));
    }
  }, [regel]);

  const preislisteUebernehmen = useCallback(() => {
    if (!regel) return;
    setManuell(false);
    setBetragRoh(betragText(regel.preis));
  }, [regel]);

  const zuruecksetzen = useCallback(() => {
    setManuell(false);
    setBetragRoh(regel ? betragText(regel.preis) : '');
  }, [regel]);

  const fehlendeAbrechnung = !!liste && !!kategorie && !regel && liste.ohneAbrechnung.has(kategorieSchluessel(kategorie));

  return {
    betrag,
    setBetrag,
    manuell,
    preislisteUebernehmen,
    zuruecksetzen,
    regel,
    zeitbasiert,
    dauerMin,
    ergebnis,
    fehlendeAbrechnung,
    geladen: !auftraggeberId || !!liste,
    /** Anzahl zum Speichern bei zeitbasierten Auslagen (sonst null → Anzahl aus dem Feld). */
    anzahlAusDauer: zeitbasiert && ergebnis?.ok ? ergebnis.anzahl : null,
    /** Für tour_zusaetze.preis_quelle. */
    preisQuelle: regel ? (manuell ? 'manuell' as const : 'preisliste' as const) : null,
  };
}

export type AuslagenAutomatik = ReturnType<typeof useAuslagenAutomatik>;

export type AuslageWerte =
  | { ok: true; anzahl: number; betrag: number; dauer_min: number | null; preis_quelle: 'preisliste' | 'manuell' | null }
  | { ok: false; text: string };

/**
 * Eingaben → Werte für tour_zusaetze. Zeitbasiert: Anzahl kommt aus der
 * Dauer; fehlt sie oder liegt sie in den Freiminuten, wird NICHT still
 * mit Anzahl 1 gespeichert.
 */
export function auslageZumSpeichern(a: AuslagenAutomatik, mengeText: string): AuslageWerte {
  const betrag = parseZahl(a.betrag);
  if (betrag == null || betrag < 0) return { ok: false, text: a.betrag.trim() ? 'Betrag ist ungültig.' : 'Bitte einen Betrag eintragen.' };
  const betrag2 = Math.round(betrag * 100) / 100;
  if (a.zeitbasiert) {
    if (!a.ergebnis || !a.ergebnis.ok) return { ok: false, text: a.ergebnis && !a.ergebnis.ok ? a.ergebnis.text : 'Bitte die Dauer eintragen.' };
    if (a.ergebnis.anzahl <= 0) return { ok: false, text: 'Die Dauer liegt innerhalb der Freiminuten — es fällt kein Betrag an.' };
    return { ok: true, anzahl: a.ergebnis.anzahl, betrag: betrag2, dauer_min: a.dauerMin, preis_quelle: a.preisQuelle };
  }
  const menge = parseZahl(mengeText);
  if (menge == null || menge < 0.01) {
    if (a.regel) return { ok: false, text: 'Anzahl ist ungültig.' };
    return { ok: true, anzahl: 1, betrag: betrag2, dauer_min: null, preis_quelle: null };
  }
  return { ok: true, anzahl: Math.round(menge * 100) / 100, betrag: betrag2, dauer_min: null, preis_quelle: a.preisQuelle };
}

/** Rechnungsnummern, auf denen die Tour als Position steht (Admin). */
export async function rechnungsnummernDerTour(tourId: string): Promise<string[]> {
  const { data } = await supabase
    .from('rechnungspositionen')
    .select('rechnung:rechnung_id (id, rechnungsnummer)')
    .eq('tour_id', tourId);
  type Row = { rechnung: { id: string; rechnungsnummer: string } | null };
  const seen = new Set<string>();
  const list: string[] = [];
  for (const r of (data as unknown as Row[]) ?? []) {
    const re = r.rechnung;
    if (!re || seen.has(re.id)) continue;
    seen.add(re.id);
    list.push(re.rechnungsnummer);
  }
  return list;
}

/**
 * Zusatz anlegen. Ist Migration 109 noch nicht eingespielt, fehlen
 * dauer_min/preis_quelle — dann ohne diese Spalten speichern.
 */
export async function zusatzEinfuegen(zeile: {
  tour_id: string; kategorie: string; anzahl: number; betrag: number; notiz: string | null;
  kennzeichen: string | null; dauer_min: number | null; preis_quelle: 'preisliste' | 'manuell' | null;
}) {
  let res = await supabase.from('tour_zusaetze').insert(zeile).select('*').single();
  if (res.error && (res.error.code === 'PGRST204' || res.error.code === '42703' || /dauer_min|preis_quelle/.test(res.error.message ?? ''))) {
    const { tour_id, kategorie, anzahl, betrag, notiz, kennzeichen } = zeile;
    res = await supabase.from('tour_zusaetze')
      .insert({ tour_id, kategorie, anzahl, betrag, notiz, kennzeichen }).select('*').single();
  }
  return res;
}
