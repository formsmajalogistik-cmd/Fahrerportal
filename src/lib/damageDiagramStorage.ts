import { supabase } from './supabase';

const BUCKET = 'damage-diagrams';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export async function uploadDamageDiagramImage(
  file: File,
  templateId: string,
  fieldId: string,
): Promise<string> {
  const path = `${templateId}/${sanitize(fieldId)}__${sanitize(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  return path;
}

export async function getDamageDiagramSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) { console.warn('Signed URL für Schadendiagramm fehlgeschlagen', error); return null; }
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------
// Fahrzeugbild für das Formular (Fahrer-Gerät)
// ---------------------------------------------------------------
//
// Vorher: einmal beim Öffnen des Formulars eine signierte URL mit 1 h
// Gültigkeit, ohne zweiten Versuch und ohne Offline-Speicher. Fehlte die
// URL (Funkloch, hängende Anfrage), tat die Skizze beim Antippen nichts.
// War sie abgelaufen und hatte das Handy den Bild-Cache geleert, lud das
// Bild im Vollbild nicht und jeder Tipp ging ins Leere — bis zum
// Neuöffnen des Formulars.
//
// Jetzt: Bild als Datei laden (angemeldeter Download, keine ablaufende
// URL), im Cache Storage des Geräts ablegen und als Blob-URL ausgeben.
// Blob-URLs laufen nicht ab; offline kommt das Bild aus dem Gerätespeicher.

const CACHE_NAME = 'maja-schadenbilder-v1';
const LADE_TIMEOUT_MS = 15_000;
const imSpeicher = new Map<string, string>();

function cacheSchluessel(path: string): string {
  // Cache Storage braucht eine URL; der Pfad wird nur als Schlüssel genutzt.
  return `${location.origin}/__schadenbild__/${encodeURIComponent(path)}`;
}

export type SchadenbildQuelle = 'speicher' | 'geraet' | 'netz';

/**
 * Liefert eine Blob-URL des Fahrzeugbilds. Reihenfolge: bereits in dieser
 * Sitzung geladen → Gerätespeicher → Netz (mit Timeout, danach im
 * Gerätespeicher abgelegt). Wirft, wenn nichts davon klappt.
 */
export async function ladeSchadenbild(path: string): Promise<{ url: string; quelle: SchadenbildQuelle }> {
  const vorhanden = imSpeicher.get(path);
  if (vorhanden) return { url: vorhanden, quelle: 'speicher' };

  let cache: Cache | null = null;
  try { cache = 'caches' in window ? await caches.open(CACHE_NAME) : null; } catch { cache = null; }
  if (cache) {
    try {
      const treffer = await cache.match(cacheSchluessel(path));
      if (treffer) {
        const url = URL.createObjectURL(await treffer.blob());
        imSpeicher.set(path, url);
        // Im Hintergrund auffrischen: tauscht der Admin das Bild unter
        // gleichem Dateinamen aus, kommt beim nächsten Mal das neue.
        if (navigator.onLine) {
          const c = cache;
          void supabase.storage.from(BUCKET).download(path).then(({ data }) => {
            if (data) void c.put(cacheSchluessel(path), new Response(data, {
              headers: { 'Content-Type': data.type || 'image/png' },
            })).catch(() => {});
          }).catch(() => {});
        }
        return { url, quelle: 'geraet' };
      }
    } catch { /* weiter zum Netz */ }
  }

  const download = supabase.storage.from(BUCKET).download(path);
  const timeout = new Promise<never>((_, reject) =>
    window.setTimeout(() => reject(new Error('Zeitüberschreitung beim Laden des Fahrzeugbilds')), LADE_TIMEOUT_MS));
  const { data, error } = await Promise.race([download, timeout]);
  if (error || !data) throw new Error(error?.message ?? 'Fahrzeugbild nicht gefunden');
  if (cache) {
    try {
      await cache.put(cacheSchluessel(path), new Response(data, {
        headers: { 'Content-Type': data.type || 'image/png' },
      }));
    } catch { /* Speicher voll — Bild trotzdem anzeigen */ }
  }
  const url = URL.createObjectURL(data);
  imSpeicher.set(path, url);
  return { url, quelle: 'netz' };
}

export async function fetchDamageDiagramBytes(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}

export async function deleteDamageDiagramImage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}
