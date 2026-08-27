// Unterschrift und Firmenstempel des Absenders (Migration 092).
//
// Beide Bilder liegen als PNG im PRIVATEN Bucket „absender" — es gibt
// keine öffentliche URL. Angezeigt wird über kurzlebige signierte URLs,
// für das PDF werden die Bytes direkt heruntergeladen. In der Datenbank
// steht nur der Pfad, nie das Bild selbst.
//
// Ablage pro Admin-Konto (auch der Stempel): siehe Begründung im Kopf
// von 092_absender_signatur.sql.

import { supabase } from './supabase';

/** Name des privaten Buckets. Wird von Migration 092 angelegt; die
 *  Konstante ist exportiert, damit Fehlermeldungen ihn benennen können. */
export const ABSENDER_BUCKET = 'absender';
/** Migration, die Bucket und Tabelle anlegt — für die Fehlermeldung,
 *  falls die Ablage in der Datenbank noch fehlt. */
export const ABSENDER_MIGRATION = '092_absender_signatur.sql';

const BUCKET = ABSENDER_BUCKET;

export type AbsenderBildArt = 'unterschrift' | 'stempel';

export interface AbsenderSignatur {
  user_id: string;
  unterschrift_pfad: string | null;
  stempel_pfad: string | null;
  aktualisiert_am: string;
}

/** Pfad-Konvention: {user_id}/{art}.png — der erste Ordner wird von der
 *  Storage-RLS gegen den eingeloggten Nutzer geprüft. */
function buildPath(userId: string, art: AbsenderBildArt): string {
  return `${userId}/${art}.png`;
}

/** Signatur-Zeile des eingeloggten Admins; null wenn noch nichts hinterlegt. */
export async function ladeAbsenderSignatur(): Promise<AbsenderSignatur | null> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('absender_signaturen').select('*').eq('user_id', uid).maybeSingle();
  if (error) {
    console.warn('[AbsenderSignatur] Laden fehlgeschlagen', error.message);
    return null;
  }
  return (data as AbsenderSignatur) ?? null;
}

/**
 * Lädt das Bild hoch (upsert, überschreibt also die vorherige Version)
 * und merkt sich den Pfad. Gibt die aktualisierte Zeile zurück.
 */
export async function speichereAbsenderBild(
  art: AbsenderBildArt, blob: Blob,
): Promise<AbsenderSignatur> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Nicht angemeldet.');

  const pfad = buildPath(uid, art);
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(pfad, blob, {
    contentType: 'image/png',
    upsert: true,
  });
  if (upErr) throw upErr;

  // Bewusst zwei ausgeschriebene Objekte statt eines berechneten
  // Schlüssels: nur so bleibt die Spalte für den Supabase-Typ bekannt.
  const patch = art === 'unterschrift'
    ? { unterschrift_pfad: pfad }
    : { stempel_pfad: pfad };
  const { data, error } = await supabase
    .from('absender_signaturen')
    .upsert(
      { user_id: uid, ...patch, aktualisiert_am: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select().single();
  if (error) throw error;
  return data as AbsenderSignatur;
}

/** Entfernt Bild und Pfad. Fehlt die Datei bereits, ist das kein Fehler. */
export async function entferneAbsenderBild(art: AbsenderBildArt): Promise<AbsenderSignatur | null> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Nicht angemeldet.');

  await supabase.storage.from(BUCKET).remove([buildPath(uid, art)]);

  const patch = art === 'unterschrift'
    ? { unterschrift_pfad: null }
    : { stempel_pfad: null };
  const { data, error } = await supabase
    .from('absender_signaturen')
    .update({ ...patch, aktualisiert_am: new Date().toISOString() })
    .eq('user_id', uid)
    .select().maybeSingle();
  if (error) throw error;
  return (data as AbsenderSignatur) ?? null;
}

/** Kurzlebige signierte URL (Default 10 Minuten) für die Vorschau. */
export async function absenderSignedUrl(
  pfad: string, expiresInSeconds = 600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(pfad, expiresInSeconds);
  if (error) {
    console.warn('[AbsenderSignatur] Signed URL fehlgeschlagen', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Bild als Data-URL — so, wie pdf-lib es über den bestehenden
 * Einbettungspfad im Brief-PDF erwartet. Schlägt der Download fehl
 * (Datei gelöscht, offline), kommt null zurück und das PDF wird ohne
 * Bild erzeugt: lieber ein Dokument ohne Unterschrift als gar keins.
 */
export async function ladeAbsenderBildDataUrl(pfad: string | null | undefined): Promise<string | null> {
  if (!pfad) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(pfad);
    if (error || !data) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(data);
    });
  } catch (err) {
    console.warn('[AbsenderSignatur] Download fehlgeschlagen', err);
    return null;
  }
}

/**
 * Beide Bilder für die PDF-Erzeugung. `mitUnterschrift`/`mitStempel`
 * sind die Schalter des jeweiligen Dokuments — steht der Schalter auf
 * aus, wird gar nicht erst geladen.
 */
export async function ladeAbsenderBilder(opts: {
  mitUnterschrift: boolean;
  mitStempel: boolean;
}): Promise<{ unterschrift: string | null; stempel: string | null }> {
  const sig = await ladeAbsenderSignatur();
  if (!sig) return { unterschrift: null, stempel: null };
  const [unterschrift, stempel] = await Promise.all([
    opts.mitUnterschrift ? ladeAbsenderBildDataUrl(sig.unterschrift_pfad) : Promise.resolve(null),
    opts.mitStempel ? ladeAbsenderBildDataUrl(sig.stempel_pfad) : Promise.resolve(null),
  ]);
  return { unterschrift, stempel };
}
