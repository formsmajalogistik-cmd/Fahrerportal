// Abgleich der Fahrzeugdaten beim Verknüpfen eines Protokolls mit einer
// bestehenden Tour (EingangLinkDialog).
//
// Früher wurden Kennzeichen, FIN und Modell nur in LEERE Tour-Felder
// übernommen. Stand auf der Tour schon ein (falscher) Wert, blieb er
// stehen — obwohl das Protokoll das tatsächlich gefahrene Fahrzeug
// dokumentiert. Jetzt werden abweichende Werte gegenübergestellt und
// der Admin entscheidet je Feld per Haken (Default: übernehmen).
//
// Der Vergleich ist tolerant: Leerzeichen, Bindestriche und Groß-/Klein-
// schreibung zählen nicht. „HH-AB 1234" und „hhab1234" sind gleich.

import type { ProtokollAbschnitt } from './touren';

export type FahrzeugFeld = 'kennzeichen' | 'fin' | 'fahrzeugmodell';

export type FahrzeugSpalte =
  | 'kennzeichen' | 'fin' | 'fin_rueck' | 'fahrzeugmodell' | 'fahrzeugmodell_rueck';

export interface AbgleichZeile {
  feld: FahrzeugFeld;
  /** Tour-Spalte, die geschrieben wird (bei Kennzeichen: Array-Slot). */
  spalte: FahrzeugSpalte;
  /** Anzeige, z.B. „Kennzeichen" oder „Kennzeichen Rück". */
  label: string;
  /** Wert auf der Tour, '' wenn leer. */
  tourWert: string;
  /** Wert aus dem Protokoll (bereits für die Tour formatiert). */
  protokollWert: string;
}

export interface TourFahrzeug {
  kennzeichen: string[] | null;
  fin: string | null;
  fin_rueck: string | null;
  fahrzeugmodell: string | null;
  fahrzeugmodell_rueck: string | null;
}

export interface ProtokollFahrzeug {
  kennzeichen: string | null | undefined;
  fin: string | null | undefined;
  fahrzeugmodell: string | null | undefined;
}

/** Vergleichsform: ohne Leerzeichen/Bindestriche, Großbuchstaben. */
export function normFahrzeugWert(v: string | null | undefined): string {
  return (v ?? '').replace(/[\s\-‐‑–—]+/g, '').toUpperCase();
}

/** Gleich im Sinne des toleranten Vergleichs. */
export function fahrzeugWertGleich(a: string | null | undefined, b: string | null | undefined): boolean {
  return normFahrzeugWert(a) === normFahrzeugWert(b);
}

/** Wert so, wie er auf der Tour gespeichert wird. */
function formatFuerTour(feld: FahrzeugFeld, v: string | null | undefined): string {
  const t = (v ?? '').trim().replace(/\s+/g, ' ');
  return feld === 'fahrzeugmodell' ? t : t.toUpperCase();
}

/**
 * Liefert die Zeilen, in denen Protokoll und Tour sich unterscheiden.
 * Ein leeres Tour-Feld gilt als Unterschied, ein leerer Protokollwert
 * nie (es gibt nichts zu übernehmen). Leere Liste = kein Abgleich nötig.
 *
 * Bei ABA/ABC zählt der gewählte Abschnitt: 'bc' vergleicht mit den
 * Rück-Spalten (Kennzeichen-Slot 1, fin_rueck, fahrzeugmodell_rueck).
 */
export function fahrzeugAbgleich(args: {
  abschnitt: ProtokollAbschnitt;
  tour: TourFahrzeug;
  protokoll: ProtokollFahrzeug;
}): AbgleichZeile[] {
  const { abschnitt, tour, protokoll } = args;
  const rueck = abschnitt === 'bc';
  const kz = Array.isArray(tour.kennzeichen) ? tour.kennzeichen : [];
  const kandidaten: Array<Omit<AbgleichZeile, 'protokollWert'> & { roh: string | null | undefined }> = [
    {
      feld: 'kennzeichen', spalte: 'kennzeichen',
      label: rueck ? 'Kennzeichen Rück' : 'Kennzeichen',
      tourWert: (kz[rueck ? 1 : 0] ?? '').trim(),
      roh: protokoll.kennzeichen,
    },
    {
      feld: 'fin', spalte: rueck ? 'fin_rueck' : 'fin',
      label: rueck ? 'FIN Rück' : 'FIN',
      tourWert: ((rueck ? tour.fin_rueck : tour.fin) ?? '').trim(),
      roh: protokoll.fin,
    },
    {
      feld: 'fahrzeugmodell', spalte: rueck ? 'fahrzeugmodell_rueck' : 'fahrzeugmodell',
      label: rueck ? 'Fahrzeugmodell Rück' : 'Fahrzeugmodell',
      tourWert: ((rueck ? tour.fahrzeugmodell_rueck : tour.fahrzeugmodell) ?? '').trim(),
      roh: protokoll.fahrzeugmodell,
    },
  ];
  const zeilen: AbgleichZeile[] = [];
  for (const k of kandidaten) {
    const protokollWert = formatFuerTour(k.feld, k.roh);
    if (!protokollWert) continue;
    if (k.tourWert && fahrzeugWertGleich(k.tourWert, protokollWert)) continue;
    zeilen.push({ feld: k.feld, spalte: k.spalte, label: k.label, tourWert: k.tourWert, protokollWert });
  }
  return zeilen;
}

/**
 * Kennzeichen-Array mit neuem Wert im Slot (0 = Hin, 1 = Rück). Fehlt
 * die Hinfahrt, bleibt an Index 0 ein leerer Platzhalter — sonst würde
 * das Rück-Kennzeichen überall als Hin-Kennzeichen gelesen.
 */
export function kennzeichenMitSlot(alt: string[] | null | undefined, slot: 0 | 1, neu: string): string[] {
  const arr = Array.isArray(alt) ? [...alt] : [];
  while (arr.length < slot) arr.push('');
  arr[slot] = neu;
  return arr;
}

export interface AbgleichErgebnis {
  /** Spalten → neue Werte für das Tour-Update. */
  patch: Record<string, unknown>;
  /** Für die Meldung „… aus Protokoll übernommen". */
  labels: string[];
  /**
   * Spalten für protokoll_daten_felder — NUR vorher leere Felder.
   * Ein überschriebener Altwert würde beim „Verknüpfung lösen +
   * zurücksetzen" sonst auf null gesetzt statt wiederhergestellt; der
   * Altwert steht stattdessen im Änderungsprotokoll.
   */
  trackKeys: string[];
  /**
   * Einträge fürs Änderungsprotokoll. `feld` ist der Protokoll-Feldname
   * (Kennzeichen Rück = 'kennzeichen_rueck', weil beide im selben Array
   * stehen).
   */
  protokoll: Array<{ feld: string; alt: string | null; neu: string }>;
}

/** Baut aus den angehakten Zeilen das Update. */
export function abgleichAnwenden(
  zeilen: AbgleichZeile[],
  gewaehlt: ReadonlySet<FahrzeugFeld>,
  abschnitt: ProtokollAbschnitt,
  tourKennzeichen: string[] | null | undefined,
): AbgleichErgebnis {
  const erg: AbgleichErgebnis = { patch: {}, labels: [], trackKeys: [], protokoll: [] };
  for (const z of zeilen) {
    if (!gewaehlt.has(z.feld)) continue;
    if (z.feld === 'kennzeichen') {
      erg.patch.kennzeichen = kennzeichenMitSlot(tourKennzeichen, abschnitt === 'bc' ? 1 : 0, z.protokollWert);
    } else {
      erg.patch[z.spalte] = z.protokollWert;
    }
    erg.labels.push(z.label);
    if (!z.tourWert) erg.trackKeys.push(z.spalte);
    const feld = z.feld === 'kennzeichen' && abschnitt === 'bc' ? 'kennzeichen_rueck' : z.spalte;
    erg.protokoll.push({ feld, alt: z.tourWert || null, neu: z.protokollWert });
  }
  return erg;
}
