import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { isBoxEntry, isOptionsEntry, isTextEntry, OPTION_DEFAULT_SIZE, TEXT_DEFAULT_FONT } from './fieldMapping';
import type { FieldMapping, FormSchema } from '../types/db';

const ACCENT = rgb(0.17, 0.37, 0.54); // Maja-Accent
const LIGHT  = rgb(0.91, 0.94, 0.97);

/**
 * Erzeugt eine Vorschau-PDF auf Basis der PDF-Vorlage. Jedes gemappte Feld
 * wird mit seinem Label gezeichnet. Bei Mehrfach-/Auswahlfeldern wird pro
 * Option ein Häkchen plus Optionsname gezeichnet.
 */
export async function buildPreviewPdf(
  templateBytes: ArrayBuffer,
  schema: FormSchema,
  mapping: FieldMapping,
): Promise<Blob> {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fieldById = new Map<string, { label: string; type: string }>();
  for (const s of schema.sections ?? []) {
    for (const f of s.fields ?? []) {
      fieldById.set(f.id, { label: f.label, type: f.type });
    }
  }

  const pages = pdf.getPages();

  for (const [fieldId, entry] of Object.entries(mapping)) {
    const meta = fieldById.get(fieldId);
    const label = meta?.label ?? fieldId;

    if (isTextEntry(entry)) {
      const page = pages[Math.max(0, Math.min(entry.page - 1, pages.length - 1))];
      page.drawText(`[${label}]`, {
        x: entry.x, y: entry.y,
        size: entry.fontSize ?? TEXT_DEFAULT_FONT,
        font, color: ACCENT,
      });
      continue;
    }

    if (isBoxEntry(entry)) {
      const page = pages[Math.max(0, Math.min(entry.page - 1, pages.length - 1))];
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
      for (const [optName, pos] of Object.entries(entry.options)) {
        const page = pages[Math.max(0, Math.min(pos.page - 1, pages.length - 1))];
        const size = pos.size ?? OPTION_DEFAULT_SIZE;
        // Häkchen als ✓ in einer Box
        page.drawRectangle({
          x: pos.x, y: pos.y,
          width: size, height: size,
          borderColor: ACCENT, borderWidth: 0.7,
          color: LIGHT, opacity: 0.8,
        });
        page.drawText('X', {
          x: pos.x + size * 0.2,
          y: pos.y + size * 0.2,
          size: size * 0.8,
          font, color: ACCENT,
        });
        page.drawText(optName, {
          x: pos.x + size + 3,
          y: pos.y + 1,
          size: 8, font, color: ACCENT,
        });
      }
    }
  }

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
