// Echte PDF-Generierung mit den vom Fahrer eingegebenen Daten.
// Wird beim Submit für jedes PDF im Template aufgerufen.

import { PDFDocument, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  computeDynamicSlots,
  isBoxEntry, isCheckboxesWithTextEntry, isDynamicEntry, isOptionsEntry,
  isTextEntry,
  OPTION_DEFAULT_SIZE, TEXT_DEFAULT_FONT,
} from './fieldMapping';
import { fetchDamageDiagramBytes } from './damageDiagramStorage';
import { supabase } from './supabase';
import { fetchPdfBytes } from './pdfStorage';
import type {
  AusgefuelltesFormular, FieldMapping, FormSchema, FormularTemplate,
  PhotoValue, TemplatePdf,
} from '../types/db';

const INK = rgb(0.06, 0.14, 0.22); // Maja-Ink
const SUBMIT_PHOTOS_BUCKET = 'formular-fotos';
const OUTPUT_BUCKET = 'formular-pdfs';

interface CheckTextEntry { option: string; text: string }

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function asPhoto(v: unknown): PhotoValue | null {
  if (v && typeof v === 'object' && 'storage_path' in v) return v as PhotoValue;
  return null;
}

function asPhotos(v: unknown): PhotoValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is PhotoValue =>
    !!x && typeof x === 'object'
    && typeof (x as { storage_path?: unknown }).storage_path === 'string'
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchSubmittedPhotoBytes(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from(SUBMIT_PHOTOS_BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}

/**
 * Zeichnet ein Bild mit den Marker-Punkten als PNG-Bytes — wird für
 * damage_diagram-Felder beim PDF-Export genutzt.
 */
async function renderDamageDiagramWithMarkers(
  imageBytes: ArrayBuffer,
  markers: Array<{ x: number; y: number }>,
  outputWidth: number,
  outputHeight: number,
): Promise<Uint8Array | null> {
  return await new Promise((resolve) => {
    const blob = new Blob([imageBytes]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // pixelgenau auf Ziel-Größe rendern (PDF-Punkte ≈ Pixel bei 72 dpi)
        canvas.width = Math.max(1, Math.round(outputWidth));
        canvas.height = Math.max(1, Math.round(outputHeight));
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); URL.revokeObjectURL(url); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Marker
        const r = Math.max(8, Math.min(canvas.width, canvas.height) * 0.025);
        ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        markers.forEach((m, idx) => {
          const cx = (m.x / 100) * canvas.width;
          const cy = (m.y / 100) * canvas.height;
          ctx.beginPath();
          ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'white';
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.fillText(String(idx + 1), cx, cy + 1);
        });

        canvas.toBlob((b) => {
          URL.revokeObjectURL(url);
          if (!b) { resolve(null); return; }
          b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
        }, 'image/png');
      } catch (err) {
        console.warn('renderDamageDiagram fehlgeschlagen', err);
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function embedImage(pdf: PDFDocument, bytes: ArrayBuffer | Uint8Array, hint?: string) {
  const lower = (hint ?? '').toLowerCase();
  if (lower.endsWith('.png')) return pdf.embedPng(bytes);
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return pdf.embedJpg(bytes);
  // Default: PNG erst, JPG-Fallback
  try { return await pdf.embedPng(bytes); }
  catch { return await pdf.embedJpg(bytes); }
}

/**
 * Füllt eine PDF-Vorlage mit den Daten aus dem Formular und gibt die Bytes zurück.
 */
export async function fillPdf(
  templateBytes: ArrayBuffer,
  schema: FormSchema,
  mapping: FieldMapping,
  data: Record<string, unknown>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fields = new Map<string, { type: string; vehicleImage?: string }>();
  for (const s of schema.sections ?? []) {
    for (const f of s.fields ?? []) {
      fields.set(f.id, { type: f.type, vehicleImage: f.vehicleImage });
    }
  }

  const page = (n: number): PDFPage => {
    const pages = pdf.getPages();
    return pages[Math.max(0, Math.min(n - 1, pages.length - 1))];
  };

  for (const [fieldId, entry] of Object.entries(mapping)) {
    const value = data[fieldId];
    const meta = fields.get(fieldId);

    if (isTextEntry(entry)) {
      const text = asString(value);
      if (!text) continue;
      page(entry.page).drawText(text, {
        x: entry.x, y: entry.y,
        size: entry.fontSize ?? TEXT_DEFAULT_FONT,
        font, color: INK,
      });
      continue;
    }

    if (isOptionsEntry(entry)) {
      let selected: string[] = [];
      if (entry.type === 'select') {
        if (typeof value === 'string' && value) selected = [value];
      } else {
        if (Array.isArray(value)) selected = value.filter((v): v is string => typeof v === 'string');
      }
      for (const opt of selected) {
        const pos = entry.options[opt];
        if (!pos) continue;
        const size = pos.size ?? OPTION_DEFAULT_SIZE;
        page(pos.page).drawText('X', {
          x: pos.x, y: pos.y, size, font, color: INK,
        });
      }
      continue;
    }

    if (isCheckboxesWithTextEntry(entry)) {
      const entries: CheckTextEntry[] = Array.isArray(value)
        ? value.filter((x): x is CheckTextEntry =>
            !!x && typeof x === 'object'
            && typeof (x as { option?: unknown }).option === 'string'
            && typeof (x as { text?: unknown }).text === 'string')
        : [];
      for (const e of entries) {
        const map = entry.options[e.option];
        if (!map) continue;
        const cb = map.checkbox;
        const sz = cb.size ?? OPTION_DEFAULT_SIZE;
        page(cb.page).drawText('X', { x: cb.x, y: cb.y, size: sz, font, color: INK });
        if (e.text.trim()) {
          const tx = map.text;
          page(tx.page).drawText(e.text, {
            x: tx.x, y: tx.y, size: tx.fontSize ?? TEXT_DEFAULT_FONT,
            font, color: INK,
          });
        }
      }
      continue;
    }

    if (isBoxEntry(entry)) {
      // damage_diagram → vehicle image + Marker einbetten
      if (entry.type === 'damage_diagram' && meta?.vehicleImage) {
        const bg = await fetchDamageDiagramBytes(meta.vehicleImage);
        if (!bg) continue;
        const markers = Array.isArray(value)
          ? (value as Array<{ x: number; y: number }>)
              .filter((m) => typeof m?.x === 'number' && typeof m?.y === 'number')
          : [];
        const png = await renderDamageDiagramWithMarkers(
          bg, markers, entry.width * 4, entry.height * 4,
        );
        if (!png) continue;
        const img = await pdf.embedPng(png);
        page(entry.page).drawImage(img, {
          x: entry.x, y: entry.y - entry.height,
          width: entry.width, height: entry.height,
        });
        continue;
      }
      // photo
      if (entry.type === 'photo') {
        const photo = asPhoto(value);
        if (!photo) continue;
        const bytes = await fetchSubmittedPhotoBytes(photo.storage_path);
        if (!bytes) continue;
        try {
          const img = await embedImage(pdf, bytes, photo.storage_path);
          page(entry.page).drawImage(img, {
            x: entry.x, y: entry.y - entry.height,
            width: entry.width, height: entry.height,
          });
        } catch (err) {
          console.warn(`[fillPdf] photo ${fieldId} embed failed`, err);
        }
        continue;
      }
      // signature
      if (entry.type === 'signature') {
        const dataUrl = typeof value === 'string' ? value : '';
        const sig = dataUrlToBytes(dataUrl);
        if (!sig) continue;
        try {
          const img = await pdf.embedPng(sig);
          page(entry.page).drawImage(img, {
            x: entry.x, y: entry.y - entry.height,
            width: entry.width, height: entry.height,
          });
        } catch (err) {
          console.warn(`[fillPdf] signature ${fieldId} embed failed`, err);
        }
        continue;
      }
      continue;
    }

    if (isDynamicEntry(entry)) {
      const photos = asPhotos(value);
      if (photos.length === 0) continue;
      // Bei mehr Fotos als perPage: Original-Seite kopieren
      const slots = computeDynamicSlots(entry, photos.length);
      const startPageIdx = Math.max(0, Math.min(entry.page - 1, pdf.getPageCount() - 1));
      const pagesNeeded = Math.max(...slots.map((s) => s.pageOffset)) + 1;
      // Ziel-Seiten beschaffen: bei pageOffset > 0 fügen wir Kopien von startPage ein.
      const targetPages: PDFPage[] = [pdf.getPages()[startPageIdx]];
      for (let i = 1; i < pagesNeeded; i += 1) {
        const [copied] = await pdf.copyPages(pdf, [startPageIdx]);
        // Direkt nach der ursprünglichen Seite einsetzen
        const insertIdx = startPageIdx + i;
        pdf.insertPage(insertIdx, copied);
        targetPages.push(copied);
      }
      for (let i = 0; i < photos.length; i += 1) {
        const slot = slots[i];
        const photo = photos[i];
        const bytes = await fetchSubmittedPhotoBytes(photo.storage_path);
        if (!bytes) continue;
        try {
          const img = await embedImage(pdf, bytes, photo.storage_path);
          targetPages[slot.pageOffset].drawImage(img, {
            x: slot.x, y: slot.y - slot.height,
            width: slot.width, height: slot.height,
          });
        } catch (err) {
          console.warn(`[fillPdf] dynamic photo ${i} embed failed`, err);
        }
      }
      continue;
    }
  }

  return await pdf.save();
}

/**
 * Generiert alle PDFs eines Templates für ein konkretes Formular und
 * speichert sie im Bucket formular-pdfs unter <userId>/<formularId>/<pdfId>.pdf.
 * Liefert die Liste der erfolgreich erzeugten Pfade zurück.
 */
export async function generateAndUploadFormPdfs(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  userId: string,
): Promise<string[]> {
  const generated: string[] = [];
  for (const tplPdf of template.pdfs ?? []) {
    if (!tplPdf.path) continue;
    try {
      const tplBytes = await fetchPdfBytes(tplPdf.path);
      if (!tplBytes) continue;
      const out = await fillPdf(
        tplBytes, template.schema, tplPdf.field_mapping ?? {}, formular.daten,
      );
      const outPath = `${userId}/${formular.id}/${tplPdf.id}.pdf`;
      const blob = new Blob([out as unknown as ArrayBuffer], { type: 'application/pdf' });
      const { error } = await supabase.storage
        .from(OUTPUT_BUCKET)
        .upload(outPath, blob, { contentType: 'application/pdf', upsert: true });
      if (error) {
        console.warn(`[generateAndUploadFormPdfs] upload ${outPath} fehlgeschlagen`, error);
        continue;
      }
      generated.push(outPath);
    } catch (err) {
      console.warn(`[generateAndUploadFormPdfs] PDF ${tplPdf.id} fehlgeschlagen`, err);
    }
  }
  return generated;
}

/**
 * Listet die bereits generierten PDFs eines Formulars im Storage und gibt
 * pro Eintrag den TemplatePdf-Eintrag (für Anzeigename) und den Storage-Pfad zurück.
 */
export function expectedPdfPath(
  pdf: TemplatePdf, userId: string, formularId: string,
): string {
  return `${userId}/${formularId}/${pdf.id}.pdf`;
}

export async function getPdfDownloadUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}
