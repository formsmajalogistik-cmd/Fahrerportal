// Abgleich der Upload-Warteschlange mit dem tatsächlichen Formularstand.
//
// Läuft beim App-Start, beim Öffnen eines Formulars, vor „Abschließen"
// und auf Knopfdruck („Synchronisierung prüfen"). Entfernt Einträge, auf
// die das Formular nicht mehr verweist (Foto ersetzt, gelöscht oder schon
// hochgeladen), und gibt fehlgeschlagenen, noch gebrauchten Einträgen
// einen neuen Versuch — der Pfad wird dabei neu berechnet, eine Korrektur
// des Kennzeichens greift also auch für bereits wartende Bilder.
//
// Löscht NIE Formulardaten und nie ein Bild, auf das noch irgendein Stand
// verweist. Ohne bekannten Stand (kein Entwurf, keine Einreichung, Formular
// nicht offen) bleibt ein Eintrag unangetastet.
// Regeln: lib/uploadQueue.ts.

import {
  aktualisiereUploadWennVorhanden, enqueueSubmission, getFormDraft, getPendingSubmission,
  getUploadQueue, removeFromUploadQueue,
} from './offlineDb';
import { abgleichPlanen, entfernePendingFoto, sammlePendingIds } from './uploadQueue';
import { diagnose } from './diagnose';

/** Frisch aufgenommene Bilder in Ruhe lassen — der Entwurf folgt erst nach 2 s. */
const SCHONFRIST_MS = 60_000;

export interface AbgleichErgebnis {
  entfernt: number;
  zurueckgesetzt: number;
  einreichungenAktualisiert: number;
}

/**
 * Hat der Fahrer nach „Abschließen" weitergearbeitet (z.B. Fotos ersetzt),
 * verweist der Schnappschuss der wartenden Einreichung noch auf die alten
 * Platzhalter. Diese Felder werden aus dem neueren Stand übernommen —
 * sonst hielte die Einreichung verwaiste Einträge für immer am Leben bzw.
 * ginge mit Platzhaltern statt Fotos raus.
 */
export function einreichungAuffrischen(
  einreichung: Record<string, unknown>, neuer: Record<string, unknown>,
): { daten: Record<string, unknown>; geaendert: boolean } {
  const neuIds = sammlePendingIds(neuer);
  let daten = einreichung;
  let geaendert = false;
  for (const [feld, wert] of Object.entries(einreichung)) {
    const alt = [...sammlePendingIds(wert)].filter((id) => !neuIds.has(id));
    if (alt.length === 0) continue;
    if (daten === einreichung) daten = { ...einreichung };
    if (feld in neuer) {
      daten[feld] = neuer[feld];
    } else {
      let w: unknown = wert;
      for (const id of alt) w = entfernePendingFoto(w, id) ?? w;
      daten[feld] = w;
    }
    geaendert = true;
  }
  return { daten, geaendert };
}

export async function uploadAbgleich(opts: {
  /** Nur dieses Formular abgleichen. */
  formularId?: string;
  /** Stand auf dem Bildschirm (neuer als der Entwurf auf dem Gerät). */
  aktuelleDaten?: Record<string, unknown>;
  anlass?: string;
  /**
   * Fehlgeschlagene, noch gebrauchte Einträge neu starten (Default). Beim
   * Abschließen aus — dort entscheidet der Fahrer („Trotzdem abschließen").
   */
  fehlgeschlageneNeuStarten?: boolean;
} = {}): Promise<AbgleichErgebnis> {
  const ergebnis: AbgleichErgebnis = { entfernt: 0, zurueckgesetzt: 0, einreichungenAktualisiert: 0 };
  let items = await getUploadQueue();
  if (opts.formularId) items = items.filter((i) => i.formularId === opts.formularId);
  const formularIds = new Set(items.map((i) => i.formularId));
  if (opts.formularId) formularIds.add(opts.formularId);

  const quellen = new Map<string, Array<Record<string, unknown>>>();
  for (const fid of formularIds) {
    const bildschirm = fid === opts.formularId ? opts.aktuelleDaten : undefined;
    const entwurf = await getFormDraft(fid).catch(() => null);
    const einreichung = await getPendingSubmission(fid).catch(() => null);
    const neuester = bildschirm ?? entwurf?.data;
    const neuerAlsEinreichung = !!bildschirm || (!!entwurf && !!einreichung && entwurf.savedAt > einreichung.queuedAt);
    if (einreichung && neuester && neuerAlsEinreichung) {
      const r = einreichungAuffrischen(einreichung.data, neuester);
      if (r.geaendert) {
        einreichung.data = r.daten;
        await enqueueSubmission(einreichung);
        ergebnis.einreichungenAktualisiert += 1;
      }
    }
    quellen.set(fid, [bildschirm, entwurf?.data, einreichung?.data].filter(
      (d): d is Record<string, unknown> => !!d && typeof d === 'object',
    ));
  }

  const plan = abgleichPlanen({ items, quellen, jetzt: Date.now(), schonfristMs: SCHONFRIST_MS });
  for (const id of plan.entfernen) {
    await removeFromUploadQueue(id);
    ergebnis.entfernt += 1;
  }
  for (const id of (opts.fehlgeschlageneNeuStarten === false ? [] : plan.zuruecksetzen)) {
    const ok = await aktualisiereUploadWennVorhanden(id, {
      status: 'wartet', attempts: 0, nextRetryAt: 0,
    });
    if (ok) ergebnis.zurueckgesetzt += 1;
  }
  if (ergebnis.entfernt || ergebnis.zurueckgesetzt || ergebnis.einreichungenAktualisiert) {
    diagnose('upload_abgleich', {
      anlass: opts.anlass ?? 'unbekannt',
      entfernt: ergebnis.entfernt,
      zurueckgesetzt: ergebnis.zurueckgesetzt,
      einreichungen: ergebnis.einreichungenAktualisiert,
      warteschlange_vorher: items.length,
    }, 'upload', opts.formularId ?? null);
  }
  return ergebnis;
}
