// Zusatz-Arten: zählt eine Art als „Auslage"? (Migration 113)
//
// Maßgeblich ist die Tabelle zusatz_arten (Admin, per SQL änderbar). Hier
// nur: derselbe Schlüssel wie in der Datenbank (zusatz_art_schluessel),
// das Laden der Tabelle und ein Notbehelf, falls Migration 113 noch fehlt.
// Nicht aufgeführte Arten zählen als Auslage.
//
// „Keine Auslagen" ist eine eigene Zusatz-Art: klärt den Auslagen-Status
// für ein Kennzeichen, erscheint aber nie auf Rechnung, Gutschrift, in
// Summen oder Zählern.

import { supabase } from './supabase';

export const KEINE_AUSLAGEN = 'Keine Auslagen';

/** Wie zusatz_art_schluessel() in der Datenbank. */
export function zusatzArtSchluessel(kategorie: string | null | undefined): string {
  return (kategorie ?? '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

export function istKeineAuslagen(kategorie: string | null | undefined): boolean {
  return zusatzArtSchluessel(kategorie) === 'keineauslagen';
}

/** Schlüssel → zählt als Auslage. */
export type ZusatzArten = Map<string, boolean>;

/** Nur Notbehelf ohne Migration 113 — gleiche Werte wie deren Erstbefüllung. */
const NOTBEHELF: Array<[string, boolean]> = [
  ['maut', false], ['wartezeit', false], ['rotekennzeichen', false], ['reifenhandling', false],
  ['waesche', false], ['keineauslagen', false],
];

let cache: Promise<ZusatzArten> | null = null;

export function ladeZusatzArten(): Promise<ZusatzArten> {
  if (!cache) {
    cache = (async () => {
      const { data, error } = await supabase.from('zusatz_arten').select('schluessel, zaehlt_als_auslage');
      if (error) { cache = null; return new Map(NOTBEHELF); }
      return new Map(((data ?? []) as Array<{ schluessel: string; zaehlt_als_auslage: boolean }>)
        .map((r) => [r.schluessel, r.zaehlt_als_auslage]));
    })();
  }
  return cache;
}

export function standardZusatzArten(): ZusatzArten {
  return new Map(NOTBEHELF);
}

export function zaehltAlsAuslage(kategorie: string | null | undefined, arten: ZusatzArten): boolean {
  if (istKeineAuslagen(kategorie)) return false;
  return arten.get(zusatzArtSchluessel(kategorie)) ?? true;
}
