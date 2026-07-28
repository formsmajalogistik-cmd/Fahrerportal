// Extern erstellte Protokolle/Dokumente zu einer Tour (Migration 076).
//
// Dateien liegen in OneDrive unter Maja-Logistik/Tour-Dokumente/<tourId>/.
// Der Download läuft über den Proxy mit `tour_dokument_id` — dort
// entscheidet RLS, ob der Aufrufer das Dokument sehen darf (Admin, der
// Auftraggeber der Tour, der Fahrer der Tour). Fremde Touren sind damit
// auch per Direkt-API nicht erreichbar.

import { supabase } from './supabase';
import {
  deleteFromOneDrive, downloadFromOneDrive, previewOneDrivePdf,
  triggerOneDriveDownload, uploadToOneDrive,
} from './onedrive';

export interface TourDokument {
  id: string;
  tour_id: string;
  bezeichnung: string | null;
  onedrive_path: string;
  dateiname: string;
  content_type: string | null;
  created_at: string;
}

const ROOT = 'Maja-Logistik/Tour-Dokumente';

/** Dateinamen für OneDrive entschärfen (keine Pfad-Trenner o.ä.). */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'dokument';
}

export async function listTourDokumente(tourId: string): Promise<TourDokument[]> {
  const { data, error } = await supabase
    .from('tour_dokumente')
    .select('*')
    .eq('tour_id', tourId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[tourDokumente] Laden fehlgeschlagen', error.message);
    return [];
  }
  return (data as unknown as TourDokument[]) ?? [];
}

/** Lädt eine Datei hoch und verknüpft sie mit der Tour (nur Admin). */
export async function uploadTourDokument(args: {
  tourId: string;
  file: File;
  bezeichnung?: string | null;
  userId?: string | null;
}): Promise<TourDokument> {
  const dateiname = safeName(args.file.name);
  // Zeitstempel-Präfix, damit gleichnamige Uploads sich nicht überschreiben.
  const path = `${ROOT}/${args.tourId}/${Date.now()}_${dateiname}`;
  await uploadToOneDrive(path, args.file);
  const { data, error } = await supabase
    .from('tour_dokumente')
    .insert({
      tour_id: args.tourId,
      bezeichnung: args.bezeichnung?.trim() || null,
      onedrive_path: path,
      dateiname,
      content_type: args.file.type || null,
      hochgeladen_von: args.userId ?? null,
    })
    .select('*')
    .single();
  if (error || !data) {
    // Verwaiste Datei aufräumen, damit kein Müll in OneDrive bleibt.
    try { await deleteFromOneDrive(path, null, { tourDokumentId: undefined }); } catch { /* best effort */ }
    throw new Error(error?.message ?? 'Dokument konnte nicht verknüpft werden.');
  }
  return data as unknown as TourDokument;
}

/** Entfernt Verknüpfung + Datei (nur Admin — RLS erzwingt das). */
export async function deleteTourDokument(dok: TourDokument): Promise<void> {
  // Datei ZUERST löschen — die Server-Autorisierung liest dafür die
  // DB-Zeile (RLS). Danach die Verknüpfung entfernen.
  try {
    await deleteFromOneDrive(dok.onedrive_path, null, { tourDokumentId: dok.id });
  } catch (err) {
    console.warn('[tourDokumente] Datei-Löschen fehlgeschlagen', err);
  }
  const { error } = await supabase.from('tour_dokumente').delete().eq('id', dok.id);
  if (error) throw new Error(error.message);
}

export function istPdf(dok: TourDokument): boolean {
  return (dok.content_type ?? '').includes('pdf')
    || dok.dateiname.toLowerCase().endsWith('.pdf');
}

/** Vorschau (PDF) bzw. Download — beides über den autorisierten Proxy. */
export async function previewTourDokument(dok: TourDokument): Promise<boolean> {
  return await previewOneDrivePdf(dok.onedrive_path, {
    filename: dok.dateiname,
    tourDokumentId: dok.id,
  });
}

export async function downloadTourDokument(dok: TourDokument): Promise<boolean> {
  return await triggerOneDriveDownload(dok.onedrive_path, dok.dateiname, {
    tourDokumentId: dok.id,
  });
}

/** Object-URL für Bild-Vorschauen (JPG/PNG). Caller gibt sie wieder frei. */
export async function tourDokumentObjectUrl(dok: TourDokument): Promise<string | null> {
  try {
    const blob = await downloadFromOneDrive(dok.onedrive_path, { tourDokumentId: dok.id });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[tourDokumente] Bild laden fehlgeschlagen', err);
    return null;
  }
}
