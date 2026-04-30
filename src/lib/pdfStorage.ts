import { supabase } from './supabase';

const BUCKET = 'pdf-templates';

/** Upload einer PDF-Vorlage. Die PDF wird unter
 *  <templateId>/<pdfId>__<filename> gespeichert.
 */
export async function uploadPdfTemplate(
  file: File,
  templateId: string,
  pdfId: string,
): Promise<string> {
  const path = `${templateId}/${sanitize(pdfId)}__${sanitize(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

export async function getPdfSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) { console.warn('Signed URL für PDF-Template fehlgeschlagen', error); return null; }
  return data?.signedUrl ?? null;
}

export async function fetchPdfBytes(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}

export async function deletePdfFromStorage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}

/**
 * Kopiert eine PDF-Vorlage im Storage. Liest die Quelle, lädt sie unter neuem
 * Pfad wieder hoch. Gibt den neuen Pfad zurück oder null bei Fehler.
 */
export async function copyPdfInStorage(
  sourcePath: string,
  newTemplateId: string,
  pdfId: string,
): Promise<string | null> {
  const bytes = await fetchPdfBytes(sourcePath);
  if (!bytes) return null;
  const filename = sourcePath.split('/').pop() ?? 'template.pdf';
  // pdfId-Prefix wird im Filename mitgeführt — wir bauen den neuen Pfad neu auf
  const cleanName = filename.replace(/^[^_]+__/, '');
  const path = `${newTemplateId}/${sanitize(pdfId)}__${sanitize(cleanName)}`;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) { console.warn('PDF-Kopie fehlgeschlagen', error); return null; }
  return path;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
