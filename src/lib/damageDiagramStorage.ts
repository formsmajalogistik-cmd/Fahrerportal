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

export async function fetchDamageDiagramBytes(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}

export async function deleteDamageDiagramImage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}
