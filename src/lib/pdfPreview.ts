import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FieldMapping, FormSchema } from '../types/db';

/**
 * Erzeugt eine Preview-PDF auf Basis der PDF-Vorlage. Jedes gemappte Feld
 * wird mit seinem Label (und einer Bounding-Box bei Foto-Feldern) gezeichnet.
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
    const pageIdx = Math.max(0, Math.min(entry.page - 1, pages.length - 1));
    const page = pages[pageIdx];
    const meta = fieldById.get(fieldId);
    const label = meta?.label ?? fieldId;
    const fontSize = entry.fontSize ?? 10;

    if (entry.width && entry.height) {
      // Bounding-Box zeichnen (z.B. für Foto-Felder)
      page.drawRectangle({
        x: entry.x,
        y: entry.y - entry.height,
        width: entry.width,
        height: entry.height,
        borderColor: rgb(0.17, 0.37, 0.54),
        borderWidth: 1,
        color: rgb(0.91, 0.94, 0.97),
        opacity: 0.5,
      });
      page.drawText(label, {
        x: entry.x + 4,
        y: entry.y - 12,
        size: fontSize,
        font,
        color: rgb(0.17, 0.37, 0.54),
      });
    } else {
      page.drawText(`[${label}]`, {
        x: entry.x,
        y: entry.y,
        size: fontSize,
        font,
        color: rgb(0.17, 0.37, 0.54),
      });
    }
  }

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
