// E-Rechnung: Hilfen für Empfänger-Stammdaten (Migration 115).
//
// Die Regeln für PLZ/Ort und Land entsprechen exakt dem Probelauf
// supabase/scripts/erechnung_adressen_probelauf.sql — beide bewusst
// vorsichtig: Unklares wird nie geraten, sondern „manuell prüfen".

import { supabase } from '../supabase';

export type ERechnungFormat = 'pdf' | 'xrechnung_cii' | 'zugferd';

export const ERECHNUNG_FORMATE: ReadonlyArray<{ wert: ERechnungFormat; label: string; aktiv: boolean }> = [
  { wert: 'pdf', label: 'PDF (wie bisher)', aktiv: true },
  { wert: 'xrechnung_cii', label: 'XRechnung (CII)', aktiv: false },
  { wert: 'zugferd', label: 'ZUGFeRD / Factur-X', aktiv: false },
];

export function istERechnungFormat(v: unknown): v is ERechnungFormat {
  return v === 'pdf' || v === 'xrechnung_cii' || v === 'zugferd';
}

/** Häufige Länder für die Auswahlhilfe (ISO 3166-1 alpha-2). */
export const LAENDER: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'DE', name: 'Deutschland' }, { code: 'AT', name: 'Österreich' },
  { code: 'CH', name: 'Schweiz' }, { code: 'NL', name: 'Niederlande' },
  { code: 'BE', name: 'Belgien' }, { code: 'LU', name: 'Luxemburg' },
  { code: 'FR', name: 'Frankreich' }, { code: 'DK', name: 'Dänemark' },
  { code: 'PL', name: 'Polen' }, { code: 'CZ', name: 'Tschechien' },
  { code: 'IT', name: 'Italien' }, { code: 'ES', name: 'Spanien' },
  { code: 'SE', name: 'Schweden' }, { code: 'NO', name: 'Norwegen' },
  { code: 'GB', name: 'Vereinigtes Königreich' },
];

const LAND_MAP: Record<string, string> = {
  deutschland: 'DE', germany: 'DE', de: 'DE', d: 'DE', brd: 'DE', 'bundesrepublik deutschland': 'DE',
  'österreich': 'AT', oesterreich: 'AT', austria: 'AT', at: 'AT', a: 'AT',
  schweiz: 'CH', switzerland: 'CH', ch: 'CH',
  niederlande: 'NL', holland: 'NL', netherlands: 'NL', nl: 'NL',
  belgien: 'BE', belgium: 'BE', be: 'BE',
  luxemburg: 'LU', luxembourg: 'LU', lu: 'LU',
  frankreich: 'FR', france: 'FR', fr: 'FR',
  'dänemark': 'DK', daenemark: 'DK', denmark: 'DK', dk: 'DK',
  polen: 'PL', poland: 'PL', pl: 'PL',
  tschechien: 'CZ', 'tschechische republik': 'CZ', 'czech republic': 'CZ', cz: 'CZ',
  italien: 'IT', italy: 'IT', it: 'IT',
  spanien: 'ES', spain: 'ES', es: 'ES',
  schweden: 'SE', sweden: 'SE', se: 'SE',
  norwegen: 'NO', norway: 'NO', no: 'NO',
  'vereinigtes königreich': 'GB', 'großbritannien': 'GB', 'united kingdom': 'GB', uk: 'GB', gb: 'GB',
};

/**
 * Freitext-Land → ISO-Code. Leer → 'DE' (Standard). Unbekannt → null.
 */
export function landZuIso(land: string | null | undefined): string | null {
  const t = (land ?? '').trim();
  if (!t) return 'DE';
  return LAND_MAP[t.toLowerCase()] ?? null;
}

/** Eingabe normalisieren: „de " → „DE"; ungültig → null. */
export function normLandCode(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

export interface PlzOrtVorschlag {
  plz: string | null;
  ort: string | null;
  landCode: string | null;
  status: 'eindeutig' | 'manuell';
  hinweise: string[];
}

/**
 * „28816 Stuhr" → PLZ 28816, Ort Stuhr. Nur deutsche 5-stellige PLZ
 * (optional mit „D-") gelten als eindeutig; alles andere = manuell.
 */
export function trennePlzOrt(plzOrt: string | null | undefined, land?: string | null): PlzOrtVorschlag {
  const s = (plzOrt ?? '').trim();
  const landCode = landZuIso(land);
  const hinweise: string[] = [];
  if (!(land ?? '').trim()) hinweise.push('Land leer → Standard DE');
  if (landCode == null) hinweise.push(`Land „${(land ?? '').trim()}" nicht zugeordnet`);
  if (!s) {
    hinweise.unshift('keine PLZ/Ort hinterlegt');
    return { plz: null, ort: null, landCode, status: 'manuell', hinweise };
  }
  let m = /^([0-9]{5})\s+(\S.*)$/.exec(s);
  if (!m) {
    m = /^[Dd]\s*-?\s*([0-9]{5})\s+(\S.*)$/.exec(s);
    if (m) hinweise.push('Präfix „D-" entfernt');
  }
  if (!m) {
    hinweise.push('Format nicht erkannt');
    if (landCode && landCode !== 'DE') hinweise.push('Ausland — PLZ-Format bitte prüfen');
    return { plz: null, ort: null, landCode, status: 'manuell', hinweise };
  }
  const plz = m[1];
  const ort = m[2].trim();
  let status: 'eindeutig' | 'manuell' = 'eindeutig';
  if (landCode !== 'DE') {
    status = 'manuell';
    if (landCode) hinweise.push('Ausland — PLZ-Format bitte prüfen');
  }
  if (/[0-9]/.test(ort)) { status = 'manuell'; hinweise.push('Ziffern im Ort'); }
  return { plz, ort, landCode, status, hinweise };
}

/** „PLZ Ort" so zusammensetzen, wie die bestehenden Masken es tun. */
export function plzOrtZusammen(plz: string | null | undefined, ort: string | null | undefined): string {
  return [(plz ?? '').trim(), (ort ?? '').trim()].filter(Boolean).join(' ');
}

/** Gleich bis auf Mehrfach-Leerzeichen? */
export function gleicheAdresszeile(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string | null | undefined) => (x ?? '').trim().replace(/\s+/g, ' ');
  return n(a) === n(b);
}

// ---------------------------------------------------------------
// Ist Migration 115 schon eingespielt? Bis dahin werden die neuen
// Felder weder angezeigt noch geschrieben — die Masken funktionieren
// dann exakt wie vorher.
// ---------------------------------------------------------------
let schemaCache: Promise<boolean> | null = null;

export function erechnungSchemaVorhanden(): Promise<boolean> {
  if (!schemaCache) {
    schemaCache = (async () => {
      const { error } = await supabase.from('rechnungen').select('faellig_am').limit(1);
      if (!error) return true;
      console.warn('[E-Rechnung] Migration 115 nicht erkannt:', error.message);
      // „nein" nicht dauerhaft merken — beim nächsten Aufruf neu fragen.
      schemaCache = null;
      return false;
    })();
  }
  return schemaCache;
}

/** Nur für Tests. */
export function _schemaCacheSetzen(wert: boolean | null): void {
  schemaCache = wert == null ? null : Promise.resolve(wert);
}
