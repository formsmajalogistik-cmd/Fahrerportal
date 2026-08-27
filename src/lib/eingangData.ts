// Extrahiert die wichtigsten Tour-relevanten Daten aus einem ausgefüllten
// Formular (ausgefuellte_formulare.daten). Templates haben unterschiedliche
// Feld-IDs; wir prüfen daher gängige Schreibweisen und fallback auf
// "irgendein Feld dessen ID enthält…".

import { composeAdresse } from './adresse';
import type { AusgefuelltesFormular } from '../types/db';

/**
 * Adresse eines Protokolls in Einzelteilen — dieselbe Form, die das
 * Formular-Adressfeld liefert ({strasse, plz, stadt}) und die die Tour
 * seit Migration 086/087 speichert.
 *
 * Wird beim Verknüpfen 1:1 in strasse_* / plz_* / <Station>_stadt
 * übernommen. Liefert ein älteres Template die Adresse als reinen
 * Freitext, landet der Wert in `strasse`; PLZ und Stadt bleiben leer —
 * bewusst KEIN Zerlegen, das ist zu fehleranfällig.
 */
export interface AdresseTeile {
  strasse: string | null;
  plz: string | null;
  stadt: string | null;
}

export interface EingangSummary {
  kennzeichen: string | null;
  fahrername: string | null;
  kundenname: string | null;
  /** Datum als ISO-Date-String (oder null). */
  datum: string | null;
  /** Zusammengesetzt ("Straße, PLZ Stadt") — für Anzeige und Route. */
  adresseUebernahme: string | null;
  adresseUebergabe: string | null;
  /** Dieselben Adressen in Einzelteilen, für die Tour-Spalten. */
  adresseUebernahmeTeile: AdresseTeile;
  adresseUebergabeTeile: AdresseTeile;
  fin: string | null;
  /** Fahrzeugmodell laut Protokoll — füllt je nach Abschnitt
   *  `fahrzeugmodell` oder `fahrzeugmodell_rueck` der Tour. */
  fahrzeugmodell: string | null;
  kmGesamt: number | null;
  /** Kontaktperson vor Ort — Name, Telefon, E-Mail. */
  kontaktName: string | null;
  kontaktTelefon: string | null;
  kontaktEmail: string | null;
}

function s(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

const LEERE_TEILE: AdresseTeile = { strasse: null, plz: null, stadt: null };

/**
 * Adresswert eines Formularfeldes in Einzelteile zerlegen.
 *
 *   { strasse, plz, stadt }  → 1:1 übernommen (Standard-Adressfeld)
 *   "Musterweg 3, 28195 …"   → komplett ins Straßenfeld; PLZ und Stadt
 *                              bleiben leer. Kein Parsing.
 */
function addressTeile(v: unknown): AdresseTeile {
  if (!v) return { ...LEERE_TEILE };
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? { strasse: t, plz: null, stadt: null } : { ...LEERE_TEILE };
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return { strasse: s(o.strasse), plz: s(o.plz), stadt: s(o.stadt) };
  }
  return { ...LEERE_TEILE };
}

/** Zusammengesetzte Adresse — identisches Format wie in der Tour. */
function addressString(v: unknown): string | null {
  const t = addressTeile(v);
  return composeAdresse(t);
}

function findKey(data: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) if (c in data) return data[c];
  // Fallback: enthält-Match (case-insensitive)
  const lc = candidates.map((c) => c.toLowerCase());
  for (const key of Object.keys(data)) {
    const k = key.toLowerCase();
    if (lc.some((c) => k.includes(c))) return data[key];
  }
  return undefined;
}

export function summarizeEingang(formular: AusgefuelltesFormular): EingangSummary {
  const data = (formular.daten ?? {}) as Record<string, unknown>;
  const kennzeichen = s(findKey(data, ['kennzeichen', 'Kennzeichen']));
  const fahrername  = s(findKey(data, ['fahrername', 'fahrer_name', 'Fahrername']));
  const kundenname  = s(findKey(data, ['kundenname', 'kunde', 'Kundenname']));
  const fin         = s(findKey(data, ['fin', 'FIN', 'fahrzeugidentifizierungsnummer']));
  // "fahrzeugmodell" zuerst — sonst würde der enthält-Fallback von
  // "modell" auch auf "fahrzeugmodell_rueck" o.ä. greifen.
  const fahrzeugmodell = s(findKey(data, [
    'fahrzeugmodell', 'fahrzeug_modell', 'modell', 'fahrzeugtyp', 'fahrzeug',
  ]));

  const km = findKey(data, ['uebergabe_km', 'uebernahme_km', 'km_gesamt', 'km']);
  const kmGesamt = typeof km === 'number' && Number.isFinite(km)
    ? Math.round(km)
    : (typeof km === 'string' && km.trim() !== '' && Number.isFinite(Number(km))
      ? Math.round(Number(km))
      : null);

  // Datum: bevorzugt Übernahme, sonst Übergabe, sonst created_at.
  const dateRaw =
    findKey(data, ['uebernahme_datum', 'datum_uebernahme', 'startdatum'])
    ?? findKey(data, ['uebergabe_datum', 'datum_uebergabe', 'enddatum'])
    ?? formular.created_at;
  let datum: string | null = null;
  if (typeof dateRaw === 'string' && dateRaw) {
    const d = new Date(dateRaw);
    if (!isNaN(d.getTime())) datum = d.toISOString();
  }

  const rohUebernahme = findKey(data, ['uebernahme_adresse', 'adresse_uebernahme', 'abholort']);
  const rohUebergabe  = findKey(data, ['uebergabe_adresse', 'adresse_uebergabe', 'zielort']);
  const adresseUebernahmeTeile = addressTeile(rohUebernahme);
  const adresseUebergabeTeile  = addressTeile(rohUebergabe);
  const adresseUebernahme = addressString(rohUebernahme);
  const adresseUebergabe  = addressString(rohUebergabe);

  // Kontaktperson vor Ort — Templates haben unterschiedliche Feld-IDs
  // ("kontakt", "ansprechpartner", "rufnummer", "email_kunde", …). Wir
  // probieren mehrere Varianten und fallen ggf. auf den Kunden zurück.
  const kontaktName = s(findKey(data, [
    'kontakt_name', 'kontakt', 'ansprechpartner', 'kontaktperson',
  ])) ?? kundenname;
  const kontaktTelefon = s(findKey(data, [
    'kontakt_telefon', 'rufnummer', 'telefon', 'tel', 'phone',
  ]));
  const kontaktEmail = s(findKey(data, [
    'kontakt_email', 'email_kunde', 'email', 'e_mail', 'mail',
  ]));

  return {
    kennzeichen,
    fahrername,
    kundenname,
    datum,
    adresseUebernahme,
    adresseUebergabe,
    adresseUebernahmeTeile,
    adresseUebergabeTeile,
    fin,
    fahrzeugmodell,
    kmGesamt,
    kontaktName,
    kontaktTelefon,
    kontaktEmail,
  };
}

export function formatGermanDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  // Wenn die ISO-/Form-Eingabe eine Uhrzeit enthält ("YYYY-MM-DDTHH:MM"),
  // hängen wir die Stundenangabe an die deutsche Anzeige an (Aufgabe 3).
  const date = d.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  if (typeof iso === 'string' && iso.includes('T')) {
    const time = d.toLocaleTimeString('de-DE', {
      hour: '2-digit', minute: '2-digit',
    });
    return `${date}, ${time}`;
  }
  return date;
}
