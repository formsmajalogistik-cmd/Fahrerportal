// Brief-PDF — dasselbe Layout wie die Rechnungs-PDF.
//
// Kopfzeile, Logo, Absenderangaben, Empfänger-Adressblock und Fußzeile
// kommen als geteilte Bausteine aus rechnungPdf.ts. Nur der Mittelteil
// unterscheidet sich: statt Positionstabelle der Brieftext, darunter
// der Unterschriftsbereich.
//
// Dadurch bleibt das Design automatisch konsistent — eine Änderung am
// Rechnungskopf wirkt hier mit.

import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import {
  A4_H, INK, MARGIN_BOTTOM, MARGIN_X,
  drawAbsenderRechts, drawAbsenderzeile, drawFliesstext,
  fetchLogoBytes, newPage, winAnsi,
  type Fonts, type PageCtx,
} from '../rechnungen/rechnungPdf';

export interface BriefPdfInput {
  briefNr: string;
  /** ISO-Date. */
  datum: string;
  betreff: string;
  /** Brieftext mit bereits aufgelösten Platzhaltern. */
  inhalt: string;
  /** Adressblock-Zeilen — leere Teile sind bereits entfernt. */
  empfaengerZeilen: string[];
  /** Ort für die Unterschriftszeile. */
  ort?: string;
  /** Data-URL der erfassten Unterschrift; null = Linie zum Unterschreiben. */
  unterschrift?: string | null;
  /** ISO-Zeitstempel der digitalen Unterschrift. */
  unterschriebenAm?: string | null;
}

function datumDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE');
}

function zeitstempelDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Empfänger links, Brief-Meta rechts — wie der Rechnungskopf. */
function drawEmpfaengerUndMeta(ctx: PageCtx, input: BriefPdfInput) {
  const { page, fonts } = ctx;
  const startY = ctx.y;

  let yL = startY;
  for (let i = 0; i < input.empfaengerZeilen.length; i += 1) {
    page.drawText(winAnsi(input.empfaengerZeilen[i]), {
      x: MARGIN_X, y: yL,
      size: i === 0 ? 11 : 10,
      font: i === 0 ? fonts.bold : fonts.regular,
      color: INK,
    });
    yL -= i === 0 ? 14 : 13;
  }

  const meta: Array<[string, string]> = [
    ['Brief:', input.briefNr],
    ['Datum:', datumDe(input.datum)],
  ];
  let yR = startY;
  const rechtsX = 380;
  for (const [k, v] of meta) {
    page.drawText(winAnsi(k), { x: rechtsX, y: yR, size: 9, font: fonts.bold, color: INK });
    page.drawText(winAnsi(v), { x: rechtsX + 80, y: yR, size: 9, font: fonts.regular, color: INK });
    yR -= 13;
  }

  ctx.y = Math.min(yL, yR) - 18;
}

/**
 * Unterschriftsbereich. Bei signierten Briefen wird die erfasste
 * Unterschrift eingebettet, sonst bleibt eine Linie zum Unterschreiben.
 */
async function drawUnterschrift(
  ctx: PageCtx, doc: PDFDocument, input: BriefPdfInput,
) {
  const { page, fonts } = ctx;
  // Genug Platz? Sonst neue Seite.
  if (ctx.y < MARGIN_BOTTOM + 130) {
    const neu = newPage(doc, ctx.fonts, ctx.logo, 'Brief');
    ctx.page = neu.page;
    ctx.y = neu.y;
  }

  ctx.y -= 24;
  const ortDatum = [input.ort || '', datumDe(input.unterschriebenAm ?? input.datum)]
    .filter(Boolean).join(', ');
  page.drawText(winAnsi(ortDatum), {
    x: MARGIN_X, y: ctx.y, size: 9, font: fonts.regular, color: INK,
  });
  ctx.y -= 8;

  // Unterschrift des Empfängers (links).
  const linienY = ctx.y - 46;
  if (input.unterschrift) {
    try {
      const base64 = input.unterschrift.split(',')[1] ?? '';
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      let bild: PDFImage;
      if (input.unterschrift.startsWith('data:image/png')) {
        bild = await doc.embedPng(bytes);
      } else {
        bild = await doc.embedJpg(bytes);
      }
      const maxB = 180;
      const maxH = 44;
      const skala = Math.min(maxB / bild.width, maxH / bild.height, 1);
      page.drawImage(bild, {
        x: MARGIN_X,
        y: linienY + 4,
        width: bild.width * skala,
        height: bild.height * skala,
      });
    } catch {
      // Unterschrift nicht einbettbar — die Linie bleibt stehen.
    }
  }

  page.drawLine({
    start: { x: MARGIN_X, y: linienY },
    end: { x: MARGIN_X + 200, y: linienY },
    thickness: 0.7,
    color: rgb(0.6, 0.65, 0.7),
  });
  page.drawText(winAnsi('Unterschrift Empfänger'), {
    x: MARGIN_X, y: linienY - 11, size: 8, font: fonts.regular, color: rgb(0.45, 0.5, 0.56),
  });
  if (input.unterschriebenAm) {
    page.drawText(
      winAnsi(`Digital unterschrieben am ${zeitstempelDe(input.unterschriebenAm)}`),
      { x: MARGIN_X, y: linienY - 22, size: 8, font: fonts.regular, color: rgb(0.45, 0.5, 0.56) },
    );
  }

  // Absender (rechts).
  page.drawLine({
    start: { x: 340, y: linienY },
    end: { x: 340 + 200, y: linienY },
    thickness: 0.7,
    color: rgb(0.6, 0.65, 0.7),
  });
  page.drawText(winAnsi('M. Janßen, Maja-Logistik'), {
    x: 340, y: linienY - 11, size: 8, font: fonts.regular, color: rgb(0.45, 0.5, 0.56),
  });

  ctx.y = linienY - 34;
}

export function briefPdfFilename(briefNr: string): string {
  const sicher = briefNr.replace(/[\\/:*?"<>|]/g, '-');
  return `Brief_${sicher}.pdf`;
}

export async function generateBriefPdf(input: BriefPdfInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { regular, bold };

  const logoBytes = await fetchLogoBytes();
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const ctx = newPage(doc, fonts, logo, 'Brief');
  drawAbsenderRechts(ctx);
  ctx.y = A4_H - 150;
  drawAbsenderzeile(ctx);
  drawEmpfaengerUndMeta(ctx, input);

  // Betreff
  if (input.betreff.trim()) {
    ctx.page.drawText(winAnsi(input.betreff.trim()), {
      x: MARGIN_X, y: ctx.y, size: 12, font: fonts.bold, color: INK,
    });
    ctx.y -= 22;
  }

  // Brieftext. drawFliesstext bricht selbst um; bei langen Briefen
  // legen wir vorher eine neue Seite an.
  for (const absatz of input.inhalt.split(/\n{2,}/)) {
    const text = absatz.replace(/\n/g, ' ').trim();
    if (!text) continue;
    if (ctx.y < MARGIN_BOTTOM + 90) {
      const neu = newPage(doc, fonts, logo, 'Brief');
      ctx.page = neu.page;
      ctx.y = neu.y;
    }
    drawFliesstext(ctx, text);
    ctx.y -= 6;
  }

  await drawUnterschrift(ctx, doc, input);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
