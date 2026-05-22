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
import { fetchPdfBytes } from './pdfStorage';
import {
  deleteFromOneDrive, downloadFromOneDrive, previewOneDrivePdf, sendEmail,
  triggerOneDriveDownload, uploadToOneDrive,
} from './onedrive';
import { buildFormularFolder, pathForPdf } from './onedrivePaths';
import type {
  AusgefuelltesFormular, FieldMapping, FormSchema, FormularTemplate,
  PhotoValue, TemplatePdf,
} from '../types/db';

const INK = rgb(0.06, 0.14, 0.22); // Maja-Ink

interface CheckTextEntry { option: string; text: string }

/**
 * Konvertiert beliebigen User-Input in einen für WinAnsi-Schriften
 * (Helvetica) sicheren String — die Standard-Schriften der PDF können
 * z.B. den Pfeil → (U+2192), em-/en-Dashes oder typografische Anführungs-
 * zeichen nicht direkt darstellen. Umlaute und € sind in WinAnsi schon
 * enthalten und werden NICHT verändert.
 */
function winAnsi(s: string): string {
  return s
    .replace(/→/g, '»')
    .replace(/←/g, '«')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[•·]/g, '*')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xFF]/g, '?');
}

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return winAnsi(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/**
 * Liest einen Wert aus dem Formular-`daten`-JSON. Unterstützt zusätzlich
 * Sub-Field-Schlüssel mit Punktnotation (z.B. `adresse.strasse`) — dabei
 * wird zuerst der Top-Level-Schlüssel geprüft, danach das gleichnamige
 * Sub-Feld in einem object-Wert.
 */
function readDataValue(data: Record<string, unknown>, key: string): unknown {
  if (key in data) return data[key];
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const head = key.slice(0, dot);
  const tail = key.slice(dot + 1);
  const parent = data[head];
  if (parent && typeof parent === 'object' && tail in (parent as Record<string, unknown>)) {
    return (parent as Record<string, unknown>)[tail];
  }
  return undefined;
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

async function fetchSubmittedPhotoBytes(
  path: string, formularId: string | null,
): Promise<ArrayBuffer | null> {
  // Photos liegen in OneDrive. Der Download-Proxy verlangt für Fahrer
  // zwingend formular_id (Pro-Resource-Auth); für Admin ist es optional,
  // wir reichen es aber durch, sobald wir es haben.
  try {
    const blob = await downloadFromOneDrive(path, { formularId });
    const buf = await blob.arrayBuffer();
    console.info(`[PDF] Bild geladen: ${path.split('/').pop()} (${buf.byteLength} B)`);
    return buf;
  } catch (err) {
    console.error('[PDF] Bild-Download fehlgeschlagen', { path, formularId, err });
    return null;
  }
}

/**
 * Zeichnet ein Bild mit den Marker-Punkten als PNG-Bytes — wird für
 * damage_diagram-Felder beim PDF-Export genutzt.
 */
// Farben pro Schadensart — entsprechen DamageKind in src/types/db.ts
const DAMAGE_KIND_COLOR: Record<string, string> = {
  D: 'rgba(245, 158, 11, 0.95)',   // amber
  K: 'rgba(220, 38, 38, 0.95)',    // red
  S: 'rgba(147, 51, 234, 0.95)',   // purple
  U: 'rgba(234, 88, 12, 0.95)',    // orange
};

async function renderDamageDiagramWithMarkers(
  imageBytes: ArrayBuffer,
  markers: Array<{ x: number; y: number; kind?: string }>,
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

        // Marker — Buchstabe statt Nummer (D/K/S/U); Fallback "?"
        // Etwa halbe Größe wie zuvor (entspricht visuell den UI-Markern).
        const r = Math.max(5, Math.min(canvas.width, canvas.height) * 0.0125);
        ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        markers.forEach((m) => {
          const cx = (m.x / 100) * canvas.width;
          const cy = (m.y / 100) * canvas.height;
          const kind = (m.kind ?? '').toString().toUpperCase();
          const color = DAMAGE_KIND_COLOR[kind] ?? 'rgba(27, 58, 92, 0.95)';
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'white';
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.fillText(kind || '?', cx, cy + 1);
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
 * Re-encoded ein Foto vor dem Einbetten in eine PDF nochmal kleiner —
 * 1200 px lange Kante, JPEG q=0.6. Das halbiert in der Regel die finale
 * PDF-Größe und hält uns sicher unter dem Vercel-Function-Payload-Limit
 * von 4.5 MB. Bei extrem kleinen Bildern (< 200 KB) bleibt das Original
 * unverändert, weil eine Re-Encode-Runde dort nichts mehr bringt.
 */
async function compressForPdfEmbed(
  source: ArrayBuffer | Uint8Array,
  hint?: string,
): Promise<{ bytes: Uint8Array; hintOut: string }> {
  const buf = source instanceof Uint8Array
    ? source.slice().buffer as ArrayBuffer
    : source;
  const size = (source as Uint8Array | ArrayBuffer).byteLength;
  if (size < 200 * 1024) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(buf);
    return { bytes, hintOut: hint ?? '' };
  }
  try {
    const blob = new Blob([buf], { type: (hint ?? '').toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = (e) => reject(e);
        i.src = url;
      });
      const maxSide = 1200;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxSide || h > maxSide) {
        const r = Math.min(maxSide / w, maxSide / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
      ctx.drawImage(img, 0, 0, w, h);
      const outBlob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.6),
      );
      if (!outBlob) throw new Error('toBlob lieferte null');
      const out = new Uint8Array(await outBlob.arrayBuffer());
      // Wenn das Ergebnis trotz Re-Encode größer wäre als das Original
      // (passiert bei sehr kleinen, bereits komprimierten Originalen),
      // behalten wir das Original — sonst hätten wir zusätzlich
      // Qualitätsverlust und keinen Größengewinn.
      if (out.byteLength >= size) {
        const bytes = source instanceof Uint8Array ? source : new Uint8Array(buf);
        return { bytes, hintOut: hint ?? '' };
      }
      return { bytes: out, hintOut: 'image.jpg' };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('[compressForPdfEmbed] Re-Encode fehlgeschlagen, nutze Original', err);
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(buf);
    return { bytes, hintOut: hint ?? '' };
  }
}

/**
 * Berechnet Zeichenmaße so, dass ein Bild OHNE Verzerrung in eine Box passt.
 * Der Box-Anker `boxX` ist der RECHTE Rand der Box; das Bild wird daher mit
 * seinem rechten Rand an `boxX` ausgerichtet (rechtsbündig).
 * Querformat-Bilder (Breite > Höhe) füllen die volle Boxbreite aus.
 * Hochformat-Bilder (Höhe > Breite) nutzen die volle Boxhöhe als Anker;
 * die resultierende Breite ist kleiner und das Bild bleibt rechtsbündig
 * platziert (links bleibt Platz frei).
 */
function aspectFit(
  imgWidth: number, imgHeight: number,
  boxX: number, boxY: number, boxWidth: number, boxHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (imgWidth <= 0 || imgHeight <= 0) {
    return { x: boxX - boxWidth, y: boxY - boxHeight, width: boxWidth, height: boxHeight };
  }
  const isPortrait = imgHeight > imgWidth;
  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  if (isPortrait) {
    drawHeight = boxHeight;
    drawWidth = boxHeight * (imgWidth / imgHeight);
    if (drawWidth > boxWidth) {
      drawWidth = boxWidth;
      drawHeight = boxWidth * (imgHeight / imgWidth);
    }
  }
  // PDF-Koordinaten: y ist der OBERE Rand → unteren Rand berechnen.
  // Rechtsbündig (boxX = rechter Rand), top-aligned an boxY.
  return {
    x: boxX - drawWidth,
    y: boxY - drawHeight,
    width: drawWidth,
    height: drawHeight,
  };
}

/**
 * Füllt eine PDF-Vorlage mit den Daten aus dem Formular und gibt die Bytes
 * zurück. `formularId` wird an den Foto-Download durchgereicht — der
 * /api/download-Proxy verlangt für Fahrer eine formular_id.
 */
export async function fillPdf(
  templateBytes: ArrayBuffer,
  schema: FormSchema,
  mapping: FieldMapping,
  data: Record<string, unknown>,
  formularId: string | null = null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fields = new Map<string, { type: string; vehicleImage?: string }>();
  for (const s of schema.sections ?? []) {
    for (const f of s.fields ?? []) {
      fields.set(f.id, { type: f.type, vehicleImage: f.vehicleImage });
    }
  }

  // Snapshot der ursprünglichen Seiten-Objekte. dynamic_photos kann
  // weitere Seiten EINFÜGEN — Text-/Options-Mappings müssen aber
  // weiterhin auf die ursprünglichen Seiten zeichnen, sonst landet
  // Text z.B. auf einer Foto-Kopie statt der Original-Seite 2.
  const originalPages = pdf.getPages().slice();
  const page = (n: number): PDFPage => {
    return originalPages[Math.max(0, Math.min(n - 1, originalPages.length - 1))];
  };

  // Mapping-Übersicht — hilft bei Diagnose, wenn eine Vorlage nicht
  // wie erwartet aussieht (z.B. zweiseitige Vorlage mit 16 Foto-Feldern,
  // die später beim Render-Schritt scheitert).
  const mappingEntries = Object.entries(mapping);
  const photoFieldIds = mappingEntries
    .filter(([, e]) => isBoxEntry(e) && e.type === 'photo')
    .map(([id]) => id);
  console.info(
    `[fillPdf] Pages=${originalPages.length}, mappings=${mappingEntries.length}, photo-fields=${photoFieldIds.length}`
    + (photoFieldIds.length > 0 ? ` (${photoFieldIds.join(', ')})` : ''),
  );

  for (const [fieldId, entry] of Object.entries(mapping)) {
    const value = readDataValue(data, fieldId);
    const meta = fields.get(fieldId);

    if (isTextEntry(entry)) {
      const text = asString(value);
      if (!text) continue;
      const fontSize = entry.fontSize ?? TEXT_DEFAULT_FONT;
      // X-Position ist der RECHTE Rand → Text rechtsbündig zeichnen.
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      page(entry.page).drawText(text, {
        x: entry.x - textWidth, y: entry.y,
        size: fontSize,
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
        // X-Anker = rechter Rand → 'X' rechtsbündig zeichnen.
        const xWidth = font.widthOfTextAtSize('X', size);
        page(pos.page).drawText('X', {
          x: pos.x - xWidth, y: pos.y, size, font, color: INK,
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
        // X-Anker = rechter Rand → Häkchen rechtsbündig.
        const cbWidth = font.widthOfTextAtSize('X', sz);
        page(cb.page).drawText('X', { x: cb.x - cbWidth, y: cb.y, size: sz, font, color: INK });
        if (e.text.trim()) {
          const tx = map.text;
          const tFontSize = tx.fontSize ?? TEXT_DEFAULT_FONT;
          // WinAnsi-Sicherheit: User-Input könnte → o.ä. enthalten.
          const safeText = winAnsi(e.text);
          const tWidth = font.widthOfTextAtSize(safeText, tFontSize);
          page(tx.page).drawText(safeText, {
            x: tx.x - tWidth, y: tx.y, size: tFontSize,
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
          ? (value as Array<{ x: number; y: number; kind?: string }>)
              .filter((m) => typeof m?.x === 'number' && typeof m?.y === 'number')
          : [];
        const png = await renderDamageDiagramWithMarkers(
          bg, markers, entry.width * 4, entry.height * 4,
        );
        if (!png) continue;
        const img = await pdf.embedPng(png);
        // X-Anker = rechter Rand → Bild rechtsbündig.
        page(entry.page).drawImage(img, {
          x: entry.x - entry.width, y: entry.y - entry.height,
          width: entry.width, height: entry.height,
        });
        continue;
      }
      // photo
      if (entry.type === 'photo') {
        const photo = asPhoto(value);
        if (!photo || !photo.storage_path) {
          console.info(`[fillPdf] photo ${fieldId}: SKIP (kein storage_path — value=`, value, ')');
          continue;
        }
        const bytes = await fetchSubmittedPhotoBytes(photo.storage_path, formularId);
        if (!bytes) {
          console.warn(`[fillPdf] photo ${fieldId}: SKIP (Bytes nicht ladbar, path=${photo.storage_path})`);
          continue;
        }
        try {
          const compressed = await compressForPdfEmbed(bytes, photo.storage_path);
          const img = await embedImage(pdf, compressed.bytes, compressed.hintOut);
          const fit = aspectFit(img.width, img.height,
            entry.x, entry.y, entry.width, entry.height);
          page(entry.page).drawImage(img, fit);
          console.info(
            `[fillPdf] photo ${fieldId}: OK (page ${entry.page}, `
            + `${img.width}x${img.height}, raw=${bytes.byteLength}, embed=${compressed.bytes.byteLength} bytes)`,
          );
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
          const fit = aspectFit(img.width, img.height,
            entry.x, entry.y, entry.width, entry.height);
          page(entry.page).drawImage(img, fit);
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
      const slots = computeDynamicSlots(entry, photos.length);
      const startPageIdx = Math.max(0, Math.min(entry.page - 1, originalPages.length - 1));
      const pagesNeeded = Math.max(...slots.map((s) => s.pageOffset)) + 1;
      console.info(
        `[fillPdf] dynamic_photos field=${fieldId}: photos=${photos.length}, `
        + `perPage=${entry.perPage}, pagesNeeded=${pagesNeeded}, `
        + `startPageIdx=${startPageIdx}, templatePages=${originalPages.length}`,
      );

      // Ziel-Seiten zusammenstellen.
      //   – Wenn die Vorlage MEHRERE vorbereitete Seiten ab startPage hat
      //     (z.B. Übernahme: Seite 1 + Seite 2 mit jeweils 8 Slots),
      //     nutzen wir diese ORIGINALE direkt — KEINE Duplizierung,
      //     sonst geht die zweite vorbereitete Seite verloren.
      //   – Reichen die Original-Seiten nicht (z.B. einseitige Vorlage
      //     + 16 Fotos → 2 Seiten nötig), kopieren wir die Startseite
      //     und fügen die Kopie direkt dahinter ein.
      const targetPages: PDFPage[] = [];
      for (let i = 0; i < pagesNeeded; i += 1) {
        const origIdx = startPageIdx + i;
        if (origIdx < originalPages.length) {
          targetPages.push(originalPages[origIdx]);
        } else {
          const [copied] = await pdf.copyPages(pdf, [startPageIdx]);
          const currentIdx = pdf.getPages().indexOf(originalPages[startPageIdx]);
          const insertIdx = currentIdx >= 0 ? currentIdx + i : pdf.getPageCount();
          pdf.insertPage(insertIdx, copied);
          targetPages.push(copied);
        }
      }

      for (let i = 0; i < photos.length; i += 1) {
        const slot = slots[i];
        const photo = photos[i];
        if (!photo.storage_path) continue;
        const bytes = await fetchSubmittedPhotoBytes(photo.storage_path, formularId);
        if (!bytes) {
          console.warn(`[fillPdf] dynamic photo ${i}: konnte Bytes nicht laden (${photo.storage_path})`);
          continue;
        }
        try {
          const compressed = await compressForPdfEmbed(bytes, photo.storage_path);
          const img = await embedImage(pdf, compressed.bytes, compressed.hintOut);
          const fit = aspectFit(img.width, img.height,
            slot.x, slot.y, slot.width, slot.height);
          targetPages[slot.pageOffset].drawImage(img, fit);
        } catch (err) {
          console.warn(`[fillPdf] dynamic photo ${i} embed failed`, err);
        }
      }
      continue;
    }
  }

  return await pdf.save();
}

export interface GeneratedPdf {
  pdf: TemplatePdf;        // Original-Template-Eintrag (für name, attach_pdf_ids)
  filename: string;        // resolved Filename (z.B. "Protokoll_HB-ML_421.pdf")
  onedrive_path: string;   // Pfad in OneDrive
}

/**
 * True, wenn die Vorlage NUR Bild-Felder mappt (photo / dynamic_photos)
 * und alle Werte dieser Felder in `data` leer sind. Solche reinen
 * Bild-PDFs werden bei der Generierung übersprungen — z.B. das Belege-
 * oder Zusatzbilder-PDF, wenn der Fahrer nichts hochgeladen hat.
 *
 * Gemischte Vorlagen (mit Text-/Options-Mappings) werden IMMER erzeugt,
 * weil die Textfelder relevant sein können.
 */
function isImageOnlyAndEmpty(
  mapping: FieldMapping,
  data: Record<string, unknown>,
): boolean {
  const entries = Object.entries(mapping);
  if (entries.length === 0) return false;
  let imageEntries = 0;
  let nonImageEntries = 0;
  let hasContent = false;
  for (const [fieldId, entry] of entries) {
    if (isDynamicEntry(entry)) {
      imageEntries += 1;
      const list = asPhotos(readDataValue(data, fieldId));
      if (list.some((p) => p.storage_path || p.pending_id)) hasContent = true;
    } else if (isBoxEntry(entry) && entry.type === 'photo') {
      imageEntries += 1;
      const photo = asPhoto(readDataValue(data, fieldId));
      if (photo && (photo.storage_path || photo.pending_id)) hasContent = true;
    } else {
      nonImageEntries += 1;
    }
  }
  return nonImageEntries === 0 && imageEntries > 0 && !hasContent;
}

/**
 * Generiert alle PDFs eines Templates für ein konkretes Formular und legt sie
 * in OneDrive unter dem Formular-Ordner ab. Filenames kommen aus dem
 * filename_pattern bzw. fallback auf pdf.id.
 */
export async function generateAndUploadFormPdfs(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
): Promise<GeneratedPdf[]> {
  const isoDate = formular.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const kennzeichenRaw = formular.daten?.['kennzeichen'] ?? formular.daten?.['Kennzeichen'];
  const folder = buildFormularFolder({
    date: isoDate,
    kennzeichen: typeof kennzeichenRaw === 'string' ? kennzeichenRaw : null,
    templateName: template.name,
    formularId: formular.id,
  });

  const allPdfs = template.pdfs ?? [];
  console.info(
    `[generateAndUploadFormPdfs] Template "${template.name}": ${allPdfs.length} PDF-Vorlagen konfiguriert`,
  );
  const generated: GeneratedPdf[] = [];
  for (const tplPdf of allPdfs) {
    if (!tplPdf.path) {
      console.info(`[generateAndUploadFormPdfs]   – ${tplPdf.id}: SKIP (keine PDF-Datei hochgeladen)`);
      continue;
    }
    const mapping = tplPdf.field_mapping ?? {};
    const mapKeys = Object.keys(mapping);
    if (mapKeys.length === 0) {
      console.info(`[generateAndUploadFormPdfs]   – ${tplPdf.id}: SKIP (kein Field-Mapping)`);
      continue;
    }
    if (isImageOnlyAndEmpty(mapping, formular.daten)) {
      console.info(
        `[generateAndUploadFormPdfs]   – ${tplPdf.id}: SKIP (reine Bild-Vorlage, keine Bilder vorhanden)`,
      );
      continue;
    }
    // Drei separate try/catches, damit die Fehlerquelle SOFORT erkennbar
    // ist — fetchPdfBytes vs. fillPdf vs. uploadToOneDrive.
    let tplBytes: ArrayBuffer | null = null;
    try {
      tplBytes = await fetchPdfBytes(tplPdf.path);
    } catch (err) {
      console.error(`[generateAndUploadFormPdfs] ${tplPdf.id}: FETCH-FAIL`, err);
      continue;
    }
    if (!tplBytes) {
      console.warn(`[generateAndUploadFormPdfs]   – ${tplPdf.id}: PDF-Datei konnte nicht geladen werden (${tplPdf.path})`);
      continue;
    }

    let out: Uint8Array;
    try {
      console.info(`[generateAndUploadFormPdfs] > Fülle Vorlage "${tplPdf.name}" (${tplPdf.id}) — Mapping-Einträge: ${Object.keys(mapping).length}`);
      out = await fillPdf(tplBytes, template.schema, mapping, formular.daten, formular.id);
    } catch (err) {
      console.error(`[generateAndUploadFormPdfs] ${tplPdf.id}: FILL-FAIL`, err,
        err instanceof Error ? err.stack : '');
      continue;
    }

    const filename = resolveFilename(tplPdf.filename_pattern, formular.daten, tplPdf.id);
    const onedrivePath = pathForPdf(folder, filename);
    const blob = new Blob([out as unknown as ArrayBuffer], { type: 'application/pdf' });
    try {
      await uploadToOneDrive(onedrivePath, blob);
    } catch (err) {
      console.error(`[generateAndUploadFormPdfs] ${tplPdf.id}: UPLOAD-FAIL (path=${onedrivePath}, size=${blob.size})`, err);
      continue;
    }

    console.info(
      `[generateAndUploadFormPdfs]   – ${tplPdf.id}: OK → ${filename} (${blob.size} bytes)`,
    );
    generated.push({ pdf: tplPdf, filename, onedrive_path: onedrivePath });
  }
  console.info(
    `[generateAndUploadFormPdfs] fertig: ${generated.length}/${allPdfs.length} PDFs erzeugt`,
  );
  return generated;
}

/**
 * Stempelt jede Seite einer PDF mit „ZWISCHENPROTOKOLL — ENTWURF" und
 * dem Erstellungszeitpunkt. Genutzt für die Draft-Vorschau-PDF, die
 * Admins aus begonnenen Formularen erzeugen können.
 */
async function applyZwischenWatermark(pdf: PDFDocument, dateLabel: string): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = 'ZWISCHENPROTOKOLL - ENTWURF';
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    // Halbtransparenter roter Querbalken oben.
    page.drawRectangle({
      x: 0, y: height - 28, width, height: 28,
      color: rgb(0.85, 0.18, 0.18), opacity: 0.85,
    });
    page.drawText(text, {
      x: 24, y: height - 20,
      size: 12, font, color: rgb(1, 1, 1),
    });
    page.drawText(dateLabel, {
      x: width - font.widthOfTextAtSize(dateLabel, 9) - 24,
      y: height - 18,
      size: 9, font, color: rgb(1, 1, 1),
    });
  }
}

const ZWISCHEN_ROOT = 'Maja-Logistik/Zwischenprotokolle';

export function zwischenprotokollPath(formular: AusgefuelltesFormular): string {
  return `${ZWISCHEN_ROOT}/${formular.id}/zwischenprotokoll.pdf`;
}

/**
 * Erzeugt aus dem aktuellen Daten-Stand eines Drafts eine zusammengeführte
 * PDF (alle gemappten Template-PDFs hintereinander), versieht jede Seite
 * mit einem „ZWISCHENPROTOKOLL"-Stempel und lädt sie nach OneDrive hoch.
 * Pfad ist deterministisch (`zwischenprotokollPath`), sodass „Neu
 * generieren" die alte Version einfach überschreibt.
 *
 * Felder die noch leer sind, bleiben leer — Platzhalter-Bilder o.ä.
 * werden NICHT eingefügt; das Mapping wirft einfach nichts auf die
 * Seite, wenn der Wert fehlt.
 */
export async function generateAndUploadZwischenprotokoll(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
): Promise<{ path: string; erstellt_am: string }> {
  const allPdfs = (template.pdfs ?? []).filter(
    (p) => p.path && p.field_mapping && Object.keys(p.field_mapping).length > 0,
  );
  if (allPdfs.length === 0) {
    throw new Error('Template hat keine PDF-Vorlage mit Field-Mapping.');
  }

  // Alle Vorlagen füllen und in EIN PDF-Dokument zusammenführen.
  const merged = await PDFDocument.create();
  for (const tplPdf of allPdfs) {
    let tplBytes: ArrayBuffer | null = null;
    try { tplBytes = await fetchPdfBytes(tplPdf.path!); }
    catch (err) {
      console.warn(`[Zwischenprotokoll] FETCH-FAIL ${tplPdf.id}`, err);
      continue;
    }
    if (!tplBytes) continue;
    let filled: Uint8Array;
    try {
      filled = await fillPdf(tplBytes, template.schema, tplPdf.field_mapping ?? {}, formular.daten, formular.id);
    } catch (err) {
      console.warn(`[Zwischenprotokoll] FILL-FAIL ${tplPdf.id}`, err);
      continue;
    }
    const part = await PDFDocument.load(filled as unknown as ArrayBuffer);
    const copied = await merged.copyPages(part, part.getPageIndices());
    for (const p of copied) merged.addPage(p);
  }

  if (merged.getPageCount() === 0) {
    throw new Error('Keine Seiten erzeugbar — vermutlich konnten keine Vorlagen geladen werden.');
  }

  const erstelltAm = new Date();
  const label = `Stand: ${erstelltAm.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })}`;
  await applyZwischenWatermark(merged, label);

  const out = await merged.save();
  const path = zwischenprotokollPath(formular);
  const blob = new Blob([out as unknown as ArrayBuffer], { type: 'application/pdf' });
  await uploadToOneDrive(path, blob);
  return { path, erstellt_am: erstelltAm.toISOString() };
}

/**
 * Sendet die in der Template-Email-Config konfigurierte Email mit den
 * generierten PDFs als Anhang. Platzhalter `{feld_id}` werden in to/cc/
 * subject/body durch die Werte aus `formular.daten` ersetzt.
 */
export async function sendTemplateEmail(
  template: FormularTemplate,
  formular: AusgefuelltesFormular,
  generated: GeneratedPdf[],
  /** E-Mail des einreichenden Nutzers — wird automatisch als CC ergänzt
   *  (Duplikate werden entfernt), sodass jeder eine Kopie seiner eigenen
   *  Einreichung bekommt. */
  submitterEmail?: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  const cfg = template.email_config;
  if (!cfg || !cfg.to || !cfg.to.trim()) {
    return { sent: false, reason: 'keine Email-Konfiguration' };
  }
  const data = formular.daten;
  const splitList = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  const to = splitList(resolvePattern(cfg.to, data));
  let cc = cfg.cc ? splitList(resolvePattern(cfg.cc, data)) : [];
  if (submitterEmail && submitterEmail.includes('@')) {
    const norm = (a: string) => a.trim().toLowerCase();
    const present = new Set([...to, ...cc].map(norm));
    if (!present.has(norm(submitterEmail))) cc = [...cc, submitterEmail];
  }
  if (to.length === 0) return { sent: false, reason: 'keine Empfänger' };

  const subject = resolvePattern(cfg.subject_pattern ?? template.name, data);
  const body    = resolvePattern(cfg.body_pattern ?? '', data);
  const wantedIds = new Set(cfg.attach_pdf_ids ?? []);
  const attachments = generated
    .filter((g) => wantedIds.size === 0 ? false : wantedIds.has(g.pdf.id))
    .map((g) => ({
      name: g.filename,
      contentType: 'application/pdf',
      onedrive_path: g.onedrive_path,
    }));

  await sendEmail({ to, cc: cc.length > 0 ? cc : undefined, subject, body, attachments });
  return { sent: true };
}

/**
 * Frontend-Variante des Pattern-Resolvers, ohne Filename-Sanitisierung —
 * für Subject/Body/E-Mails. Sonderzeichen bleiben erhalten.
 */
export function resolvePattern(pattern: string, data: Record<string, unknown>): string {
  if (!pattern) return '';
  // Akzeptiert auch Sub-Felder mit Dot-Notation (z.B. {adresse.stadt}) —
  // die Auflösung übernimmt readDataValue.
  return pattern.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key) => {
    const v = readDataValue(data, key);
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'ja' : 'nein';
    return '';
  });
}

/**
 * Macht aus einer Zeichenkette einen Datei-System-tauglichen Namen:
 * Slashes/Doppelpunkte/Sterne/etc. raus, mehrfache Whitespaces zu „_".
 */
export function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

/**
 * Löst ein Filename-Pattern auf. `{feld_id}` wird durch den Wert aus
 * `data` ersetzt; unbekannte oder leere Felder fallen weg. Das Ergebnis
 * wird sanitized und mit `.pdf` versehen.
 */
export function resolveFilename(
  pattern: string | null | undefined,
  data: Record<string, unknown>,
  fallback: string,
): string {
  const base = (() => {
    if (!pattern || !pattern.trim()) return fallback;
    // Auch hier Sub-Felder unterstützen ({adresse.stadt} etc.).
    const replaced = pattern.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key) => {
      const v = readDataValue(data, key);
      if (typeof v === 'string') return sanitizeFilename(v);
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'ja' : 'nein';
      return '';
    });
    const cleaned = sanitizeFilename(replaced);
    return cleaned || fallback;
  })();
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

/**
 * Lädt die generierte PDF aus OneDrive und triggert einen Browser-Download
 * mit dem gewünschten Dateinamen. `formularId` aktiviert die Pro-Resource-
 * Authorisierung im Proxy — Pflicht für Fahrer, optional für Admin.
 */
export async function downloadFormPdf(
  oneDrivePath: string, filename: string, formularId?: string | null,
): Promise<boolean> {
  return await triggerOneDriveDownload(oneDrivePath, filename, { formularId });
}

/**
 * Öffnet die PDF im Browser-Tab zur Vorschau (inline-Disposition).
 */
export async function previewFormPdf(
  oneDrivePath: string, formularId?: string | null,
): Promise<boolean> {
  return await previewOneDrivePdf(oneDrivePath, { formularId });
}

export async function deleteFormPdf(
  oneDrivePath: string, formularId: string,
): Promise<boolean> {
  return await deleteFromOneDrive(oneDrivePath, formularId);
}

/**
 * Berechnet den OneDrive-Pfad einer ausgegebenen PDF anhand von Template,
 * Formular und PDF-Eintrag — wird von der Eingänge-Seite genutzt, um den
 * Download-Pfad zu kennen, ohne das Generierungsergebnis selbst zu speichern.
 */
export function expectedOneDrivePath(
  template: FormularTemplate, formular: AusgefuelltesFormular, pdf: TemplatePdf,
): string {
  const isoDate = formular.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const kennzeichenRaw = formular.daten?.['kennzeichen'] ?? formular.daten?.['Kennzeichen'];
  const folder = buildFormularFolder({
    date: isoDate,
    kennzeichen: typeof kennzeichenRaw === 'string' ? kennzeichenRaw : null,
    templateName: template.name,
    formularId: formular.id,
  });
  const filename = resolveFilename(pdf.filename_pattern, formular.daten, pdf.id);
  return pathForPdf(folder, filename);
}
