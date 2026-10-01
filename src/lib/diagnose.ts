// Diagnose-Protokoll (Migration 100).
//
// Schreibt technische Ereignisse in `diagnose_log`, damit bei der
// nächsten Meldung eines Fahrers nachvollziehbar ist, was auf seinem
// Gerät passiert ist. Grundregeln:
//
//   * NIE Inhalte loggen — keine Bilder, keine Formularwerte. Nur
//     Ereignisnamen, Maße, Anzahlen, Feld-IDs und Fehlertexte.
//   * NIE die App stören: kein await beim Aufrufer, keine Exceptions,
//     gesammelt und verzögert gesendet.
//   * Offline nicht verlieren: Einträge liegen bis zum Senden in
//     localStorage (gedeckelt), ein späterer Aufruf oder `online` schickt
//     sie nach. Gerade Funklöcher sind der interessante Fall.

import { supabase } from './supabase';

export type DiagnoseDetails = Record<string, string | number | boolean | null | undefined>;

interface Eintrag {
  ereignis: string;
  details: DiagnoseDetails;
  formular_id: string | null;
  fahrer_id: string | null;
  bereich: string;
  geraet: string;
  zeit: string;
}

const SPEICHER_KEY = 'maja:diagnose-puffer';
const MAX_PUFFER = 200;
const SENDE_VERZOEGERUNG_MS = 1500;

let kontext: { formularId: string | null; fahrerId: string | null } = {
  formularId: null, fahrerId: null,
};

/** Formular und Fahrer, zu denen die folgenden Ereignisse gehören. */
export function setzeDiagnoseKontext(k: { formularId: string | null; fahrerId: string | null }): void {
  kontext = k;
}

function geraet(): string {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const teile = [
      navigator.userAgent.slice(0, 280),
      standalone ? 'PWA' : 'Browser',
      `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
      navigator.onLine ? 'online' : 'offline',
    ];
    return teile.join(' | ').slice(0, 400);
  } catch {
    return 'unbekannt';
  }
}

function lesePuffer(): Eintrag[] {
  try {
    const roh = localStorage.getItem(SPEICHER_KEY);
    const liste = roh ? JSON.parse(roh) : [];
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

function schreibePuffer(liste: Eintrag[]): void {
  try {
    localStorage.setItem(SPEICHER_KEY, JSON.stringify(liste.slice(-MAX_PUFFER)));
  } catch { /* voll oder gesperrt — dann eben nicht */ }
}

/** Details auf einfache, kurze Werte stutzen — Schutz vor Inhalten. */
function bereinige(details: DiagnoseDetails): DiagnoseDetails {
  const out: DiagnoseDetails = {};
  for (const [k, v] of Object.entries(details).slice(0, 20)) {
    if (v === undefined) continue;
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v);
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else out[k] = v;
  }
  return out;
}

let timer: number | null = null;
let sendetGerade = false;

async function senden(): Promise<void> {
  timer = null;
  if (sendetGerade) return;
  const puffer = lesePuffer();
  if (puffer.length === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  sendetGerade = true;
  const batch = puffer.slice(0, 50);
  try {
    const { error } = await supabase.from('diagnose_log').insert(batch.map((e) => ({
      ereignis: e.ereignis,
      details: { ...e.details, zeit_geraet: e.zeit },
      formular_id: e.formular_id,
      fahrer_id: e.fahrer_id,
      bereich: e.bereich,
      geraet: e.geraet,
    })));
    // Rechte-/Schemafehler (Test-Rolle, Migration fehlt) würden sich nie
    // von selbst lösen — dann verwerfen statt den Puffer ewig zu halten.
    const endgueltig = !!error && (
      error.code === '42501' || error.code === '42P01' || error.code === 'PGRST205'
      || error.code === '23514'
    );
    if (!error || endgueltig) {
      if (error) console.warn('[Diagnose] Einträge verworfen', error.message);
      schreibePuffer(lesePuffer().slice(batch.length));
    }
  } catch {
    // Netzfehler: Puffer bleibt, nächster Anlauf später.
  } finally {
    sendetGerade = false;
  }
  if (lesePuffer().length > 0 && navigator.onLine !== false) planeSenden(5000);
}

function planeSenden(ms = SENDE_VERZOEGERUNG_MS): void {
  if (timer != null) return;
  timer = window.setTimeout(() => { void senden(); }, ms);
}

/**
 * Ereignis protokollieren. Kehrt sofort zurück; gesendet wird gesammelt.
 * `bereich` gruppiert in der Admin-Ansicht (Standard: Schadensaufnahme).
 */
export function diagnose(
  ereignis: string,
  details: DiagnoseDetails = {},
  bereich = 'schadensaufnahme',
): void {
  try {
    const eintrag: Eintrag = {
      ereignis: ereignis.slice(0, 80),
      details: bereinige(details),
      formular_id: kontext.formularId,
      fahrer_id: kontext.fahrerId,
      bereich,
      geraet: geraet(),
      zeit: new Date().toISOString(),
    };
    console.info('[Diagnose]', eintrag.ereignis, eintrag.details);
    schreibePuffer([...lesePuffer(), eintrag]);
    planeSenden();
  } catch { /* Diagnose darf nie selbst stören */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => planeSenden(500));
}
