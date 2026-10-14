// Regeln der Foto-Upload-Warteschlange — ohne IDB/Supabase, damit sie für
// sich prüfbar sind. Ausgeführt werden sie im Sync-Drainer
// (sync/SyncContext) und im Abgleich (lib/uploadAbgleich).
//
// Anlass (produktiv): Ein Kennzeichen mit mehreren Punkten („WÜ-IT...E")
// landete ungefiltert im OneDrive-Ordner. Der Server lehnte jeden Upload
// mit 400 ab; nach 5 Versuchen gab die Warteschlange den Eintrag auf, ließ
// ihn aber liegen. Folge: Zähler „Synchronisiere … 16 Bilder" für immer,
// die wartende Einreichung blieb gesperrt. Der fertige Pfad stand im
// Eintrag — eine Korrektur des Kennzeichens half nichts. Und ein ersetztes
// Foto ließ seinen alten Eintrag als Waise zurück.

import { UploadFehler } from './onedrive';
import { buildFormularFolder, sicheresPfadSegment, sichererPfad } from './onedrivePaths';
import type { UploadQueueItem } from './offlineDb';

export type FehlerArt = 'voruebergehend' | 'dauerhaft';

/**
 * vorübergehend: Netz weg, Timeout, 5xx, 429, 408, 401 (Anmeldung wird
 *   erneuert) → automatisch später wieder versuchen.
 * dauerhaft: 400, 403, 404, 405, 410, 413, 415, 422; 409 erst beim
 *   wiederholten Auftreten → nicht endlos weiterversuchen.
 */
export function fehlerArt(err: unknown, bisherigeVersuche: number): FehlerArt {
  const status = err instanceof UploadFehler ? err.status : statusAusMeldung(err);
  if (status == null) return 'voruebergehend';
  if (status === 409) return bisherigeVersuche >= 1 ? 'dauerhaft' : 'voruebergehend';
  if ([400, 403, 404, 405, 410, 413, 415, 422].includes(status)) return 'dauerhaft';
  return 'voruebergehend';
}

/** „Upload (400): …" → 400 (für Fehler aus älteren Codepfaden). */
export function statusAusMeldung(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = /\((\d{3})\)/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** Wartezeit bis zum nächsten automatischen Versuch (30 s … 10 min). */
export function wartezeitMs(versuche: number): number {
  return Math.min(10 * 60_000, 30_000 * Math.pow(2, Math.max(0, versuche - 1)));
}

/** Endgültig fehlgeschlagen — auch Einträge der alten Version (nextRetryAt = MAX). */
export function istFehlgeschlagen(item: Pick<UploadQueueItem, 'status' | 'nextRetryAt'>): boolean {
  return item.status === 'fehlgeschlagen' || item.nextRetryAt === Number.MAX_SAFE_INTEGER;
}

/** Zeitpunkt der Aufnahme: Feld oder aus der ID („formular:feld:<zeit36>-<zufall>"). */
export function angelegtAm(item: Pick<UploadQueueItem, 'id' | 'angelegtAm'>): number | null {
  if (typeof item.angelegtAm === 'number') return item.angelegtAm;
  const teil = item.id.split(':').pop()?.split('-')[0];
  const t = teil ? parseInt(teil, 36) : NaN;
  return Number.isFinite(t) && t > 1_500_000_000_000 ? t : null;
}

/** Alle pending_ids, die irgendwo in den Formulardaten stehen (rekursiv). */
export function sammlePendingIds(wert: unknown, ziel = new Set<string>()): Set<string> {
  if (Array.isArray(wert)) {
    for (const x of wert) sammlePendingIds(x, ziel);
  } else if (wert && typeof wert === 'object') {
    const pid = (wert as { pending_id?: unknown }).pending_id;
    if (typeof pid === 'string') ziel.add(pid);
    for (const v of Object.values(wert as Record<string, unknown>)) {
      if (v && typeof v === 'object') sammlePendingIds(v, ziel);
    }
  }
  return ziel;
}

/**
 * Entfernt den Platzhalter `pendingId` aus einem Feldwert: Einzelfoto →
 * null, Liste → ohne diesen Eintrag (auch verschachtelt). `undefined` =
 * nichts gefunden.
 */
export function entfernePendingFoto(wert: unknown, pendingId: string): unknown | undefined {
  if (Array.isArray(wert)) {
    let geaendert = false;
    const next: unknown[] = [];
    for (const x of wert) {
      if (x && typeof x === 'object' && (x as { pending_id?: unknown }).pending_id === pendingId) {
        geaendert = true;
        continue;
      }
      const innen = entfernePendingFoto(x, pendingId);
      if (innen !== undefined) { geaendert = true; next.push(innen); } else next.push(x);
    }
    return geaendert ? next : undefined;
  }
  if (wert && typeof wert === 'object') {
    if ((wert as { pending_id?: unknown }).pending_id === pendingId) return null;
    let geaendert = false;
    const next: Record<string, unknown> = { ...(wert as Record<string, unknown>) };
    for (const [k, v] of Object.entries(next)) {
      if (v && typeof v === 'object') {
        const innen = entfernePendingFoto(v, pendingId);
        if (innen !== undefined) { next[k] = innen; geaendert = true; }
      }
    }
    return geaendert ? next : undefined;
  }
  return undefined;
}

/** Platzhalter aus allen Feldern eines Formulars entfernen. */
export function entfernePendingAusDaten(
  daten: Record<string, unknown>, pendingIds: Iterable<string>,
): { daten: Record<string, unknown>; geaendert: boolean } {
  let next = daten;
  let geaendert = false;
  for (const pid of pendingIds) {
    for (const [feld, wert] of Object.entries(next)) {
      const neu = entfernePendingFoto(wert, pid);
      if (neu !== undefined) {
        if (next === daten) next = { ...daten };
        next[feld] = neu;
        geaendert = true;
      }
    }
  }
  return { daten: next, geaendert };
}

export interface AbgleichPlan {
  /** Verwaist: das Formular verweist nicht mehr auf das Bild (ersetzt/gelöscht/hochgeladen). */
  entfernen: string[];
  /** Fehlgeschlagen, aber noch gebraucht → ein neuer Versuch (Pfad wird neu berechnet). */
  zuruecksetzen: string[];
}

/**
 * Entscheidet je Eintrag. `quellen` = alle bekannten Stände je Formular
 * (Bildschirm, Entwurf auf dem Gerät, wartende Einreichung, Server).
 *
 *   * keine Quelle bekannt → nichts tun (nicht beweisbar verwaist; das
 *     Bild könnte die einzige Kopie sein)
 *   * jünger als `schonfristMs` → nichts tun (der Entwurf wird erst 2 s
 *     nach der Aufnahme gespeichert)
 *   * von keiner Quelle mehr referenziert → entfernen
 *   * referenziert und fehlgeschlagen → zurücksetzen
 */
export function abgleichPlanen(args: {
  items: UploadQueueItem[];
  quellen: Map<string, Array<Record<string, unknown>>>;
  jetzt: number;
  schonfristMs: number;
}): AbgleichPlan {
  const plan: AbgleichPlan = { entfernen: [], zuruecksetzen: [] };
  const refs = new Map<string, Set<string>>();
  for (const [fid, liste] of args.quellen) {
    const set = new Set<string>();
    for (const d of liste) sammlePendingIds(d, set);
    refs.set(fid, set);
  }
  for (const item of args.items) {
    const liste = args.quellen.get(item.formularId);
    if (!liste || liste.length === 0) continue;
    const t = angelegtAm(item);
    if (t != null && args.jetzt - t < args.schonfristMs) continue;
    const referenziert = refs.get(item.formularId)?.has(item.id) ?? false;
    if (!referenziert) plan.entfernen.push(item.id);
    else if (istFehlgeschlagen(item)) plan.zuruecksetzen.push(item.id);
  }
  return plan;
}

/**
 * Upload-Pfad zum Zeitpunkt des Versuchs — aus dem AKTUELLEN Formular-
 * stand statt aus dem beim Einreihen gespeicherten Ordner. Fehlen Datum
 * oder Templatename (offline), wird der alte Ordner segmentweise bereinigt.
 */
export function uploadPfad(args: {
  item: Pick<UploadQueueItem, 'folder' | 'filename' | 'formularId'>;
  kennzeichen: string | null;
  datum: string | null;
  templateName: string | null;
}): string {
  const datei = sicheresPfadSegment(args.item.filename, 'foto.jpg');
  const ordner = args.datum && args.templateName
    ? buildFormularFolder({
      date: args.datum, kennzeichen: args.kennzeichen,
      templateName: args.templateName, formularId: args.item.formularId,
    })
    : sichererPfad(args.item.folder);
  return `${ordner}/Fotos/${datei}`;
}
