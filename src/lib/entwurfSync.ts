// Formularstand zum Server speichern — der Server ist die maßgebliche
// Quelle, der lokale Entwurf (IndexedDB) nur der Puffer für Funklöcher.
//
// Vorher schrieb der Autosave ausschließlich lokal; zum Server ging der
// Stand nur bei „Entwurf speichern", Zwischenprotokoll und Abschließen.
// Leerte iOS den Speicher der Website, war alles weg (Fall Emre Günes).
//
// Geschrieben wird BEDINGT: nur wenn der Server noch den Stand hat, den
// dieses Gerät zuletzt gesehen hat (daten_geaendert_am, Migration 107).
// Hat inzwischen jemand anders geschrieben (zweites Gerät, Admin hat einen
// Stand wiederhergestellt), wird nicht still überschrieben → 'konflikt'.

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';
import { appModus, felderAnzahl, gleicherInhalt } from './entwurfStand';
import { diagnose } from './diagnose';
import type { Json } from '../types/supabase';

export type EntwurfVorgang =
  | 'autosave' | 'hintergrund' | 'seitenwechsel' | 'entwurf' | 'nachgeholt' | 'konflikt_aufgeloest';

export type ServerSaveErgebnis =
  | { ok: true; stand: string | null }
  | { ok: false; grund: 'offline' | 'eingereicht' | 'konflikt' | 'nicht_bearbeiter' | 'fehler'; fehler?: string };

function istNetzfehler(msg: string): boolean {
  return /fetch|network|netzwerk|timeout|abgebrochen|load failed/i.test(msg);
}
export function spalteFehlt(err: { code?: string; message?: string }): boolean {
  return err.code === 'PGRST204' || err.code === '42703'
    || /daten_(vorgang|app_modus|client_stand|geaendert_am)|bearbeiter_version/.test(err.message ?? '');
}

/** Patch um die Bearbeiter-Kennung ergänzen, wenn bekannt (Migration 108). */
export function mitBearbeiter<T extends Record<string, unknown>>(patch: T, version: number | null | undefined): T {
  return typeof version === 'number' ? { ...patch, bearbeiter_version: version } : patch;
}

/** Fehler der Bearbeiter-Prüfung (Migration 108). */
export function istNichtBearbeiter(msg: string | null | undefined): boolean {
  return !!msg && msg.includes('NICHT_BEARBEITER');
}

/**
 * Formular wurde einem anderen Fahrer zugewiesen: den lokalen Stand NICHT
 * verwerfen, sondern als Snapshot beim Server abliefern (Admin kann Werte
 * daraus übernehmen). Liefert true, wenn das Formular tatsächlich
 * weggegeben wurde (sonst war es z.B. nur ohne Zugriff).
 */
export async function standNachZuweisungAbliefern(
  formularId: string, daten: Record<string, unknown> | null, anlass: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('formular_eingang_nach_zuweisung', {
      p_formular_id: formularId, p_daten: (daten ?? {}) as Json,
    });
    if (error) return false;
    const r = data as { zugewiesen?: boolean } | null;
    if (r?.zugewiesen) {
      diagnose('speichern_abgelehnt_nicht_bearbeiter', {
        anlass, ...(daten ? entwurfKennzahlen(daten) : { felder: 0, kb: 0 }),
      }, 'entwurf', formularId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * @param erwarteterStand daten_geaendert_am, den dieses Gerät zuletzt vom
 *   Server kennt. null = ohne Prüfung schreiben (nur wenn der Aufrufer
 *   sicher ist, z.B. nach einer Konflikt-Entscheidung des Fahrers).
 */
export async function entwurfZumServer(args: {
  formularId: string;
  daten: Record<string, unknown>;
  vorgang: EntwurfVorgang;
  erwarteterStand: string | null;
  /**
   * Zuletzt per keepalive (ohne Antwort) gesendeter Stand. Steht genau der
   * auf dem Server, war der abweichende Stand unser eigener → kein Konflikt.
   */
  zuletztGesendet?: Record<string, unknown> | null;
  /**
   * Bearbeiter-Kennung, mit der das Formular geladen wurde (Migration 108).
   * Wurde es inzwischen einem anderen Fahrer zugewiesen, lehnt der Server ab.
   */
  bearbeiterVersion?: number | null;
}): Promise<ServerSaveErgebnis> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, grund: 'offline' };
  const patch: Record<string, unknown> = {
    daten: args.daten as Json,
    daten_vorgang: args.vorgang,
    daten_app_modus: appModus(),
    daten_client_stand: new Date().toISOString(),
  };
  if (typeof args.bearbeiterVersion === 'number') patch.bearbeiter_version = args.bearbeiterVersion;
  try {
    let q = supabase.from('ausgefuellte_formulare').update(patch as never)
      .eq('id', args.formularId).eq('status', 'draft');
    if (args.erwarteterStand) q = q.eq('daten_geaendert_am', args.erwarteterStand);
    const { data, error } = await q.select('daten_geaendert_am').maybeSingle();
    if (error) {
      // Migration 107 noch nicht eingespielt → wenigstens die Daten sichern.
      if (spalteFehlt(error)) {
        const r = await supabase.from('ausgefuellte_formulare').update({ daten: args.daten as Json })
          .eq('id', args.formularId).eq('status', 'draft').select('id').maybeSingle();
        if (r.error) return { ok: false, grund: istNetzfehler(r.error.message) ? 'offline' : 'fehler', fehler: r.error.message };
        return r.data ? { ok: true, stand: null } : { ok: false, grund: 'eingereicht' };
      }
      if (istNichtBearbeiter(error.message)) {
        await standNachZuweisungAbliefern(args.formularId, args.daten, args.vorgang);
        return { ok: false, grund: 'nicht_bearbeiter', fehler: error.message };
      }
      return { ok: false, grund: istNetzfehler(error.message) ? 'offline' : 'fehler', fehler: error.message };
    }
    if (data) return { ok: true, stand: (data as { daten_geaendert_am: string | null }).daten_geaendert_am };
    // Keine Zeile geändert: eingereicht/übertragen — oder ein anderer Stand.
    const { data: akt } = await supabase.from('ausgefuellte_formulare')
      .select('status, uebertragen_auf_id, daten_geaendert_am, daten').eq('id', args.formularId).maybeSingle();
    const a = akt as { status: string; uebertragen_auf_id: string | null; daten_geaendert_am: string | null; daten: unknown } | null;
    if (!a) {
      // Kein Zugriff mehr: einem anderen Fahrer zugewiesen? Dann Stand abliefern.
      if (await standNachZuweisungAbliefern(args.formularId, args.daten, args.vorgang)) {
        return { ok: false, grund: 'nicht_bearbeiter' };
      }
      return { ok: false, grund: 'eingereicht' };
    }
    if (a.status !== 'draft' || a.uebertragen_auf_id) return { ok: false, grund: 'eingereicht' };
    if (args.zuletztGesendet && a.daten_geaendert_am && gleicherInhalt(a.daten, args.zuletztGesendet)) {
      return await entwurfZumServer({ ...args, erwarteterStand: a.daten_geaendert_am, zuletztGesendet: null });
    }
    return { ok: false, grund: 'konflikt' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, grund: istNetzfehler(msg) ? 'offline' : 'fehler', fehler: msg };
  }
}

/**
 * Beim Verlassen der Seite (pagehide / App in den Hintergrund): fetch mit
 * keepalive — läuft auch dann noch zu Ende, wenn iOS die Seite einfriert.
 * keepalive erlaubt nur ~64 KB; größere Stände (Unterschriften als Bild)
 * gehen über den normalen Weg. Liefert false, wenn nicht abgesetzt.
 */
export function entwurfZumServerBeimVerlassen(args: {
  formularId: string;
  daten: Record<string, unknown>;
  erwarteterStand: string | null;
  bearbeiterVersion?: number | null;
}): boolean {
  try {
    if (!navigator.onLine) return false;
    const roh = localStorage.getItem('maja-logistik-auth');
    const token = roh ? (JSON.parse(roh) as { access_token?: string }).access_token : null;
    if (!token) return false;
    const body = JSON.stringify({
      daten: args.daten,
      daten_vorgang: 'hintergrund',
      daten_app_modus: appModus(),
      daten_client_stand: new Date().toISOString(),
      ...(typeof args.bearbeiterVersion === 'number' ? { bearbeiter_version: args.bearbeiterVersion } : {}),
    });
    if (body.length > 60_000) return false;
    const qs = new URLSearchParams({ id: `eq.${args.formularId}`, status: 'eq.draft' });
    if (args.erwarteterStand) qs.set('daten_geaendert_am', `eq.${args.erwarteterStand}`);
    void fetch(`${SUPABASE_URL}/rest/v1/ausgefuellte_formulare?${qs.toString()}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body,
    }).catch(() => { /* der nächste Start holt es nach */ });
    return true;
  } catch {
    return false;
  }
}

/** Kurzinfo fürs Diagnose-Log (nie Inhalte). */
export function entwurfKennzahlen(daten: Record<string, unknown>): { felder: number; kb: number } {
  let kb = 0;
  try { kb = Math.round(JSON.stringify(daten).length / 1024); } catch { /* egal */ }
  return { felder: felderAnzahl(daten), kb };
}
