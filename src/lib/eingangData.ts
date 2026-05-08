// Extrahiert die wichtigsten Tour-relevanten Daten aus einem ausgefüllten
// Formular (ausgefuellte_formulare.daten). Templates haben unterschiedliche
// Feld-IDs; wir prüfen daher gängige Schreibweisen und fallback auf
// "irgendein Feld dessen ID enthält…".

import type { AusgefuelltesFormular } from '../types/db';

export interface EingangSummary {
  kennzeichen: string | null;
  fahrername: string | null;
  kundenname: string | null;
  /** Datum als ISO-Date-String (oder null). */
  datum: string | null;
  adresseUebernahme: string | null;
  adresseUebergabe: string | null;
  fin: string | null;
  kmGesamt: number | null;
}

function s(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function addressString(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    if (o.strasse) parts.push(String(o.strasse));
    if (o.plz || o.stadt) {
      parts.push([o.plz, o.stadt].filter(Boolean).join(' '));
    }
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
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

  const adresseUebernahme = addressString(
    findKey(data, ['uebernahme_adresse', 'adresse_uebernahme', 'abholort']),
  );
  const adresseUebergabe = addressString(
    findKey(data, ['uebergabe_adresse', 'adresse_uebergabe', 'zielort']),
  );

  return {
    kennzeichen,
    fahrername,
    kundenname,
    datum,
    adresseUebernahme,
    adresseUebergabe,
    fin,
    kmGesamt,
  };
}

export function formatGermanDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
