// Notfall: Formularwerte verloren, Fotos liegen aber in OneDrive.
//
// Fotos werden beim Aufnehmen sofort hochgeladen — mit festen Dateinamen:
//   Einzelfoto / Stempel  <feld>.jpg | <feld>.png
//   Zusatzbilder          <feld>_<Zeitstempel ms>_<Zufall>.jpg
// Damit lassen sich die Dateien eines Formularordners eindeutig den
// Bildfeldern zuordnen. Alles andere (z.B. nachträglich ergänzte Belege)
// landet in `unklar` und wird manuell zugeordnet.
//
// Der Ordner hängt vom Kennzeichen ab (…/<Datum>_<Kennzeichen>_<Template>/).
// Ist das Kennzeichen mit den Werten verloren, sucht ordnerKandidaten()
// alle Ordner mit passendem Datum und Template.

import { sicheresPfadSegment } from './onedrivePaths';
import type { FormSchema, PhotoValue } from '../types/db';

const BILD = /\.(jpe?g|png|webp|heic)$/i;

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Ordner `<datum>_<irgendwas>_<template>` im Monatsordner. */
export function ordnerKandidaten(ordnerNamen: string[], datum: string, templateName: string): string[] {
  const tpl = sicheresPfadSegment(templateName);
  const re = new RegExp(`^${esc(datum.slice(0, 10))}_.+_${esc(tpl)}$`);
  return ordnerNamen.filter((n) => re.test(n)).sort();
}

export interface FotoZuordnung {
  /** Feld-ID → Dateinamen (Zusatzbilder in Aufnahmereihenfolge). */
  zuordnung: Record<string, string[]>;
  /** Bilddateien ohne eindeutiges Feld. */
  unklar: string[];
}

export function fotosZuordnen(schema: FormSchema, dateinamen: string[]): FotoZuordnung {
  const felder = (schema.sections ?? []).flatMap((s) => s.fields ?? [])
    .filter((f) => f.type === 'photo' || f.type === 'stamp' || f.type === 'dynamic_photos');
  const zuordnung: Record<string, string[]> = {};
  const vergeben = new Set<string>();
  for (const f of felder) {
    const basis = esc(sicheresPfadSegment(f.id, f.id));
    if (f.type === 'dynamic_photos') {
      const re = new RegExp(`^${basis}_(\\d{12,})_[A-Za-z0-9-]+\\.[A-Za-z0-9]+$`);
      const treffer = dateinamen.filter((n) => re.test(n) && !vergeben.has(n))
        .sort((a, b) => Number(re.exec(a)![1]) - Number(re.exec(b)![1]));
      if (treffer.length) { zuordnung[f.id] = treffer; treffer.forEach((n) => vergeben.add(n)); }
    } else {
      const re = new RegExp(`^${basis}\\.[A-Za-z0-9]+$`);
      const treffer = dateinamen.find((n) => re.test(n) && !vergeben.has(n));
      if (treffer) { zuordnung[f.id] = [treffer]; vergeben.add(treffer); }
    }
  }
  const unklar = dateinamen.filter((n) => BILD.test(n) && !vergeben.has(n)).sort();
  return { zuordnung, unklar };
}

function mime(n: string): string {
  return /\.png$/i.test(n) ? 'image/png' : 'image/jpeg';
}

/**
 * Fotos in die Formulardaten übernehmen — nur in LEERE Einzelfelder;
 * bei Zusatzbildern werden fehlende Dateien angehängt (bereits
 * eingetragene Pfade bleiben, nichts wird doppelt eingetragen).
 */
export function datenMitFotos(
  daten: Record<string, unknown>,
  schema: FormSchema,
  zuordnung: Record<string, string[]>,
  fotoOrdner: string,
): { daten: Record<string, unknown>; gesetzt: number } {
  const felder = new Map((schema.sections ?? []).flatMap((s) => s.fields ?? []).map((f) => [f.id, f]));
  const next: Record<string, unknown> = { ...daten };
  let gesetzt = 0;
  const pfad = (n: string) => `${fotoOrdner.replace(/\/+$/, '')}/${n}`;
  for (const [feldId, dateien] of Object.entries(zuordnung)) {
    const f = felder.get(feldId);
    if (!f || dateien.length === 0) continue;
    if (f.type === 'dynamic_photos') {
      const vorhanden = Array.isArray(next[feldId]) ? (next[feldId] as PhotoValue[]) : [];
      const pfade = new Set(vorhanden.map((p) => p?.storage_path).filter(Boolean));
      const neu = dateien.filter((n) => !pfade.has(pfad(n))).map((n) => ({ storage_path: pfad(n), mime_type: mime(n) }));
      if (neu.length) { next[feldId] = [...vorhanden, ...neu]; gesetzt += neu.length; }
    } else {
      const v = next[feldId] as PhotoValue | null | undefined;
      if (v && (v.storage_path || v.pending_id)) continue;
      next[feldId] = { storage_path: pfad(dateien[0]), mime_type: mime(dateien[0]) };
      gesetzt += 1;
    }
  }
  return { daten: next, gesetzt };
}
