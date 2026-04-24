import { supabase } from './supabase';

const BUCKET = 'pdf-templates';

export async function uploadPdfTemplate(file: File, templateId: string): Promise<string> {
  const path = `${templateId}/${sanitize(file.name)}`;
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

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
