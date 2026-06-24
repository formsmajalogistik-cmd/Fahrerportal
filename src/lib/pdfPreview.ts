import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  computeDynamicSlots,
  isBoxEntry, isDynamicEntry, isOptionsEntry, isTextEntry,
  OPTION_DEFAULT_SIZE, TEXT_DEFAULT_FONT,
} from './fieldMapping';
import { fetchDamageDiagramBytes } from './damageDiagramStorage';
import type { FieldMapping, FormField, FormSchema } from '../types/db';

const ACCENT = rgb(0.17, 0.37, 0.54); // Maja-Accent
const LIGHT  = rgb(0.91, 0.94, 0.97);

/**
 * Erzeugt eine Vorschau-PDF auf Basis der PDF-Vorlage. Jedes gemappte Feld
 * wird mit seinem Label gezeichnet:
 *   - Textfelder: "[Label]" an der Position
 *   - Box-Felder (Foto/Signatur/Schadensskizze): Rechteck mit Label
 *   - Mehrfachauswahl-Felder: Häkchen + Optionsname pro gemappter Option
 *   - dynamic_photos: alle Slots der Startseite werden als nummerierte
 *     Rechtecke gezeichnet
 */
export async function buildPreviewPdf(
  templateBytes: ArrayBuffer,
  schema: FormSchema,
  mapping: FieldMapping,
): Promise<Blob> {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fieldById = new Map<string, FormField>();
  for (const s of schema.sections ?? []) {
    for (const f of s.fields ?? []) {
      fieldById.set(f.id, f);
    }
  }

  const pages = pdf.getPages();

  for (const [fieldId, entry] of Object.entries(mapping)) {
    const meta = fieldById.get(fieldId);
    const label = meta?.label ?? fieldId;

    if (isTextEntry(entry)) {
      const page = pages[Math.max(0, Math.min(entry.page - 1, pages.length - 1))];
      const fontSize = entry.fontSize ?? TEXT_DEFAULT_FONT;
      const placeholder = `[${label}]`;
      // Ausrichtung wie in fillPdf: 'left' beginnt am Anker, sonst
      // rechtsbündig (Anker = rechter Rand). Default 'right'.
      const textWidth = font.widthOfTextAtSize(placeholder, fontSize);
      page.drawText(placeholder, {
        x: entry.align === 'left' ? entry.x : entry.x - textWidth, y: entry.y,
        size: fontSize, font, color: ACCENT,
      });
      continue;
    }

    if (isBoxEntry(entry)) {
      const page = pages[Math.max(0, Math.min(entry.page - 1, pages.length - 1))];

      // Schadendiagramm mit hochgeladenem Fahrzeugbild → Bild einbetten
      const meta = fieldById.get(fieldId);
      if (entry.type === 'damage_diagram' && meta?.vehicleImage) {
        try {
          const bytes = await fetchDamageDiagramBytes(meta.vehicleImage);
          if (bytes) {
            const lower = meta.vehicleImage.toLowerCase();
            const img = lower.endsWith('.png')
              ? await pdf.embedPng(bytes)
              : await pdf.embedJpg(bytes);
            page.drawImage(img, {
              x: entry.x,
              y: entry.y - entry.height,
              width: entry.width,
              height: entry.height,
            });
            continue;
          }
        } catch (err) {
          console.warn('[pdfPreview] Schadendiagramm-Bild konnte nicht eingebettet werden', err);
          // Fall-through auf Platzhalter-Box
        }
      }

      page.drawRectangle({
        x: entry.x,
        y: entry.y - entry.height,
        width: entry.width,
        height: entry.height,
        borderColor: ACCENT,
        borderWidth: 1,
        color: LIGHT,
        opacity: 0.5,
      });
      page.drawText(label, {
        x: entry.x + 4,
        y: entry.y - 12,
        size: 10, font, color: ACCENT,
      });
      continue;
    }

    if (isOptionsEntry(entry)) {
      // Bewusst KEIN Optionsname — der Text steht bereits im Original-PDF.
      // Es wird ausschließlich ein Häkchen/X an der definierten Position gesetzt.
      for (const [, pos] of Object.entries(entry.options)) {
        const page = pages[Math.max(0, Math.min(pos.page - 1, pages.length - 1))];
        const size = pos.size ?? OPTION_DEFAULT_SIZE;
        page.drawText('X', {
          x: pos.x,
          y: pos.y,
          size,
          font, color: ACCENT,
        });
      }
      continue;
    }

    if (isDynamicEntry(entry)) {
      const page = pages[Math.max(0, Math.min(entry.page - 1, pages.length - 1))];
      const slots = computeDynamicSlots(entry, entry.perPage);
      for (const [i, s] of slots.entries()) {
        if (s.pageOffset !== 0) continue;
        page.drawRectangle({
          x: s.x,
          y: s.y - s.height,
          width: s.width,
          height: s.height,
          borderColor: ACCENT,
          borderWidth: 1,
          color: LIGHT,
          opacity: 0.5,
        });
        page.drawText(`${label} #${i + 1}`, {
          x: s.x + 4,
          y: s.y - 12,
          size: 10, font, color: ACCENT,
        });
      }
      continue;
    }
  }

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
