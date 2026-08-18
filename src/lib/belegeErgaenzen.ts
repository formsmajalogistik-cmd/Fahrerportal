// Belege nachträglich zu einem bereits eingereichten Formular ergänzen.
//
// Fachlicher Hintergrund: manche Fahrer schicken Belege per E-Mail statt
// sie in der App zu erfassen. Bisher musste der Beleg von Hand in die
// PDF montiert und die Mail manuell verschickt werden.
//
// Umsetzung
// ---------
// Die ergänzten Belege landen in DERSELBEN `dynamic_photos`-Liste in
// `ausgefuellte_formulare.daten`, in der auch die Fahrer-Belege stehen.
// Damit läuft alles Nachgelagerte unverändert weiter:
//
//   * Beleg-Slots und automatische Seiten-Duplizierung in fillPdf()
//   * "PDFs zusammenführen" setzt sie an die konfigurierte Stelle
//   * Entfernen wirkt bei der nächsten Generierung sofort
//
// Angehängt wird ans Ende — also erst Fahrer-Belege, dann ergänzte —
// solange nicht manuell umsortiert wird.
//
// Für die Nachvollziehbarkeit tragen ergänzte Einträge zusätzliche
// Felder (`nachtraeglich_ergaenzt`, `ergaenzt_am`, `ergaenzt_von`).
// pdfGenerate ignoriert unbekannte Felder, `daten` ist jsonb — eine
// Migration braucht es dafür nicht.

import { supabase } from './supabase';
import { uploadToOneDrive } from './onedrive';
import { buildFormularFolder } from './onedrivePaths';
import { brenneKennzeichenEin, pdfToJpegPages } from './pdfSeiten';
import type {
  AusgefuelltesFormular, FormSchema, PhotoValue,
} from '../types/db';

/** PhotoValue mit den Zusatzangaben einer nachträglichen Ergänzung. */
export interface ErgaenzterBeleg extends PhotoValue {
  nachtraeglich_ergaenzt?: boolean;
  /** ISO-Zeitstempel der Ergänzung. */
  ergaenzt_am?: string;
  /** app_users.id des Admins, der ergänzt hat. */
  ergaenzt_von?: string;
  /** Nur zur Anzeige — im Bild ist das Kennzeichen bereits eingebrannt. */
  kennzeichen?: string;
  /** Ursprünglicher Dateiname, damit die Liste lesbar bleibt. */
  dateiname?: string;
}

export function istErgaenzt(p: PhotoValue | ErgaenzterBeleg): boolean {
  return !!(p as ErgaenzterBeleg).nachtraeglich_ergaenzt;
}

/**
 * Alle `dynamic_photos`-Felder des Templates — das sind die Beleg-
 * Sektionen. Hat ein Template mehrere, muss der Admin wählen.
 */
export function belegFelder(
  schema: FormSchema | null | undefined,
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const s of schema?.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f?.type === 'dynamic_photos') {
        out.push({ id: f.id, label: f.label || f.id });
      }
    }
  }
  return out;
}

/** Belege eines Feldes aus `daten` lesen — robust gegen Alt-Formate. */
export function belegeAusDaten(
  daten: Record<string, unknown> | null | undefined,
  feldId: string,
): ErgaenzterBeleg[] {
  const roh = (daten ?? {})[feldId];
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (x): x is ErgaenzterBeleg => !!x && typeof x === 'object',
  );
}

/**
 * Datei(en) hochladen und als Beleg-Einträge zurückgeben.
 *
 * PDFs werden seitenweise zerlegt — jede Seite wird ein eigener Beleg,
 * genau wie im Belege-Reiter. Ein Kennzeichen wird vor dem Upload ins
 * Bild gebrannt (siehe brenneKennzeichenEin).
 */
export async function ladeBelegHoch(args: {
  formular: Pick<AusgefuelltesFormular, 'id' | 'created_at' | 'daten'>;
  templateName: string;
  datei: File;
  kennzeichen?: string;
  benutzerId: string | null;
  onFortschritt?: (text: string) => void;
}): Promise<ErgaenzterBeleg[]> {
  const { formular, templateName, datei, kennzeichen, benutzerId } = args;
  const isoDate = formular.created_at?.slice(0, 10)
    ?? new Date().toISOString().slice(0, 10);
  const daten = (formular.daten ?? {}) as Record<string, unknown>;
  const kzRoh = daten['kennzeichen'] ?? daten['Kennzeichen'];
  const ordner = buildFormularFolder({
    date: isoDate,
    kennzeichen: typeof kzRoh === 'string' ? kzRoh : null,
    templateName,
    formularId: formular.id,
  });

  // PDF → einzelne Seiten; Bilder bleiben, wie sie sind.
  let dateien: File[];
  if (datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name)) {
    dateien = await pdfToJpegPages(datei, (cur, total) => {
      args.onFortschritt?.(`${datei.name}: Seite ${cur} von ${total} …`);
    });
  } else {
    dateien = [datei];
  }

  const jetzt = new Date().toISOString();
  const ergebnis: ErgaenzterBeleg[] = [];
  for (let i = 0; i < dateien.length; i += 1) {
    const f = kennzeichen?.trim()
      ? await brenneKennzeichenEin(dateien[i], kennzeichen)
      : dateien[i];
    // Eindeutiger Name — sonst überschreibt ein zweiter Upload mit
    // gleichem Dateinamen den ersten.
    const endung = (f.name.match(/\.[^.]+$/)?.[0] ?? '.jpg').toLowerCase();
    const basis = f.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    const name = `Ergaenzt-${Date.now().toString(36)}-${i}-${basis}${endung}`;
    const pfad = `${ordner.replace(/\/+$/, '')}/Fotos/${name}`;
    args.onFortschritt?.(`Lade hoch: ${f.name} …`);
    await uploadToOneDrive(pfad, f);
    ergebnis.push({
      storage_path: pfad,
      mime_type: f.type || 'image/jpeg',
      size_bytes: f.size,
      nachtraeglich_ergaenzt: true,
      ergaenzt_am: jetzt,
      ergaenzt_von: benutzerId ?? undefined,
      kennzeichen: kennzeichen?.trim() || undefined,
      dateiname: dateien[i].name,
    });
  }
  return ergebnis;
}

/**
 * Beleg-Liste eines Feldes persistieren.
 *
 * Liest `daten` FRISCH aus der Datenbank und schreibt nur das eine
 * Beleg-Feld zurück — so geht nichts verloren, was zwischenzeitlich
 * an anderer Stelle geändert wurde.
 */
export async function speichereBelege(
  formularId: string,
  feldId: string,
  belege: ErgaenzterBeleg[],
): Promise<{ ok: boolean; fehler?: string }> {
  const { data, error } = await supabase
    .from('ausgefuellte_formulare')
    .select('daten')
    .eq('id', formularId)
    .single();
  if (error) return { ok: false, fehler: error.message };
  const daten = {
    ...((data?.daten ?? {}) as Record<string, unknown>),
    [feldId]: belege,
  };
  const { error: uErr } = await supabase
    .from('ausgefuellte_formulare')
    .update({ daten: daten as never })
    .eq('id', formularId);
  if (uErr) return { ok: false, fehler: uErr.message };
  return { ok: true };
}

/**
 * Wurde nach dem letzten E-Mail-Versand noch ein Beleg ergänzt?
 * Steuert den Hinweis „PDF neu erzeugen und ggf. erneut versenden".
 */
export function ergaenztNachVersand(
  belege: ErgaenzterBeleg[],
  versendetAm: string | null | undefined,
): boolean {
  if (!versendetAm) return false;
  const versand = new Date(versendetAm).getTime();
  if (!Number.isFinite(versand)) return false;
  return belege.some((b) => {
    if (!b.nachtraeglich_ergaenzt || !b.ergaenzt_am) return false;
    const t = new Date(b.ergaenzt_am).getTime();
    return Number.isFinite(t) && t > versand;
  });
}
