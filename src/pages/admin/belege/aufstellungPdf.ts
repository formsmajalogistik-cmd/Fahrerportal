import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

// ============================================================
// Maja-Logistik Aufstellung-PDF
// Layout: A4 Hochformat, Navy-Header mit Logo + Titel,
// alternierende Zeilen, automatischer Seitenumbruch.
// ============================================================

export interface AufstellungTourRow {
  /** Enddatum-ISO (YYYY-MM-DD) oder null. */
  enddatum: string | null;
  /** Anzeige-Route, vorgebaut: "Start → Ziel" oder "Start → Ziel → Rückführung". */
  route: string;
  /** Fahrer-Honorar in EUR (null = nicht eingetragen). */
  fahrer_honorar: number | null;
}

export interface AufstellungInput {
  fahrerNamen: string[];
  von: string;          // YYYY-MM-DD
  bis: string;          // YYYY-MM-DD
  rows: AufstellungTourRow[];
}

// Design-System-Farben (Tailwind: maja-navy / maja-accent / maja-light).
const NAVY      = rgb(0x1B / 255, 0x3A / 255, 0x5C / 255);
const ACCENT    = rgb(0x2C / 255, 0x5F / 255, 0x8A / 255);
const LIGHT     = rgb(0xE8 / 255, 0xF0 / 255, 0xF8 / 255);
const WHITE     = rgb(1, 1, 1);
const INK       = rgb(0.15, 0.18, 0.22);
const MUTED     = rgb(0.45, 0.50, 0.55);
const SEPARATOR = rgb(0.85, 0.87, 0.90);

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN_X = 36;       // 12 mm
const MARGIN_BOTTOM = 36;

const HEADER_H  = 56;
const META_H    = 64;
const TBL_HEAD_H = 22;
const ROW_H     = 22;
const SUM_ROW_H = 28;
const FOOTER_H  = 24;

// Spalten-Breiten in Punkt — Nr / Datum / Tour / Honorar
const COL = {
  nr:      28,
  datum:   72,
  honorar: 96,
};
const TABLE_W = A4_W - 2 * MARGIN_X;
const COL_TOUR = TABLE_W - COL.nr - COL.datum - COL.honorar;

function formatDateDe(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatEuro(n: number): string {
  const eur = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  // Tausender-Punkt
  return eur.replace(/\B(?=(\d{3})+(?=,))/g, '.') + ' €';
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const resp = await fetch('/Firmenlogo.png');
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch { return null; }
}

interface PageContext {
  page: PDFPage;
  bold: PDFFont;
  regular: PDFFont;
  logo: PDFImage | null;
  /** y-Cursor in pdf-lib-Koordinaten (Ursprung unten links). */
  y: number;
}

function drawHeader(ctx: PageContext) {
  const { page, bold, logo } = ctx;
  // Navy-Streifen
  page.drawRectangle({
    x: 0, y: A4_H - HEADER_H,
    width: A4_W, height: HEADER_H,
    color: NAVY,
  });
  // Logo links — proportional einpassen.
  if (logo) {
    const targetH = 32;
    const ratio = logo.width / logo.height;
    const w = targetH * ratio;
    page.drawImage(logo, {
      x: MARGIN_X,
      y: A4_H - HEADER_H + (HEADER_H - targetH) / 2,
      width: w,
      height: targetH,
    });
  }
  // Titel rechts
  const title = 'AUFSTELLUNG';
  const size = 18;
  const tw = bold.widthOfTextAtSize(title, size);
  page.drawText(title, {
    x: A4_W - MARGIN_X - tw,
    y: A4_H - HEADER_H / 2 - size / 3,
    size, font: bold, color: WHITE,
  });
}

function drawTableHeader(ctx: PageContext) {
  const { page, bold, y } = ctx;
  page.drawRectangle({
    x: MARGIN_X, y: y - TBL_HEAD_H,
    width: TABLE_W, height: TBL_HEAD_H,
    color: NAVY,
  });
  const cellY = y - TBL_HEAD_H / 2 - 4;
  let x = MARGIN_X + 6;
  page.drawText('Nr.', { x, y: cellY, size: 10, font: bold, color: WHITE });
  x += COL.nr;
  page.drawText('Datum', { x, y: cellY, size: 10, font: bold, color: WHITE });
  x += COL.datum;
  page.drawText('Tour', { x, y: cellY, size: 10, font: bold, color: WHITE });
  x += COL_TOUR;
  // Honorar rechtsbündig
  const label = 'Honorar (€)';
  const w = bold.widthOfTextAtSize(label, 10);
  page.drawText(label, {
    x: MARGIN_X + TABLE_W - 6 - w,
    y: cellY, size: 10, font: bold, color: WHITE,
  });
  ctx.y = y - TBL_HEAD_H;
}

function drawRow(
  ctx: PageContext,
  index: number,
  row: AufstellungTourRow,
  zebraIndex: number,
) {
  const { page, regular, y } = ctx;
  if (zebraIndex % 2 === 1) {
    page.drawRectangle({
      x: MARGIN_X, y: y - ROW_H, width: TABLE_W, height: ROW_H,
      color: LIGHT,
    });
  }
  // Untere Trennlinie
  page.drawLine({
    start: { x: MARGIN_X, y: y - ROW_H },
    end:   { x: MARGIN_X + TABLE_W, y: y - ROW_H },
    thickness: 0.4, color: SEPARATOR,
  });

  const baseY = y - ROW_H / 2 - 4;
  let x = MARGIN_X + 6;
  page.drawText(String(index), { x, y: baseY, size: 9.5, font: regular, color: INK });
  x += COL.nr;
  page.drawText(formatDateDe(row.enddatum), { x, y: baseY, size: 9.5, font: regular, color: INK });
  x += COL.datum;
  const route = clipToWidth(row.route, regular, 9.5, COL_TOUR - 12);
  page.drawText(route, { x, y: baseY, size: 9.5, font: regular, color: INK });

  const honorar = row.fahrer_honorar == null
    ? '—'
    : formatEuro(row.fahrer_honorar);
  const honorarColor = row.fahrer_honorar == null ? MUTED : INK;
  const honW = regular.widthOfTextAtSize(honorar, 9.5);
  page.drawText(honorar, {
    x: MARGIN_X + TABLE_W - 6 - honW,
    y: baseY, size: 9.5, font: regular, color: honorarColor,
  });
  ctx.y = y - ROW_H;
}

function clipToWidth(text: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  const ell = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const candidate = text.slice(0, mid) + ell;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + ell;
}

function drawSumRow(ctx: PageContext, sum: number) {
  const { page, bold, y } = ctx;
  // Dicke Trennlinie oben
  page.drawLine({
    start: { x: MARGIN_X, y },
    end:   { x: MARGIN_X + TABLE_W, y },
    thickness: 1.2, color: NAVY,
  });
  const baseY = y - SUM_ROW_H / 2 - 4;
  const label = 'Gesamt (netto):';
  const value = formatEuro(sum);
  const valueW = bold.widthOfTextAtSize(value, 12);
  page.drawText(label, {
    x: MARGIN_X + TABLE_W - 6 - valueW - 12 - bold.widthOfTextAtSize(label, 12),
    y: baseY, size: 12, font: bold, color: NAVY,
  });
  page.drawText(value, {
    x: MARGIN_X + TABLE_W - 6 - valueW,
    y: baseY, size: 12, font: bold, color: NAVY,
  });
  ctx.y = y - SUM_ROW_H;
}

function drawFooter(ctx: PageContext) {
  const { page, regular } = ctx;
  const date = new Date().toLocaleDateString('de-DE');
  const text = `Aufstellung erstellt am ${date} — Maja-Logistik (M. Janßen)`;
  const w = regular.widthOfTextAtSize(text, 8);
  page.drawText(text, {
    x: (A4_W - w) / 2,
    y: MARGIN_BOTTOM - 14,
    size: 8, font: regular, color: MUTED,
  });
}

function drawMetaBlock(ctx: PageContext, args: { fahrer: string; zeitraum: string; created: string }) {
  const { page, bold, regular, y } = ctx;
  const lineH = 16;
  let cur = y - 12;
  const drawPair = (k: string, v: string) => {
    page.drawText(k, { x: MARGIN_X, y: cur, size: 10, font: bold, color: ACCENT });
    page.drawText(v, { x: MARGIN_X + 90, y: cur, size: 10, font: regular, color: INK });
    cur -= lineH;
  };
  drawPair('Fahrer:',     args.fahrer);
  drawPair('Zeitraum:',   args.zeitraum);
  drawPair('Erstellt am:', args.created);
  ctx.y = y - META_H;
}

function newPage(doc: PDFDocument, fonts: { bold: PDFFont; regular: PDFFont }, logo: PDFImage | null): PageContext {
  const page = doc.addPage([A4_W, A4_H]);
  const ctx: PageContext = {
    page, bold: fonts.bold, regular: fonts.regular, logo,
    y: A4_H - HEADER_H,
  };
  drawHeader(ctx);
  return ctx;
}

export async function generateAufstellungPdf(input: AufstellungInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await fetchLogoBytes();
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  let ctx = newPage(doc, { regular, bold }, logo);
  drawMetaBlock(ctx, {
    fahrer: input.fahrerNamen.join(', ') || '—',
    zeitraum: `${formatDateDe(input.von)} – ${formatDateDe(input.bis)}`,
    created: new Date().toLocaleDateString('de-DE'),
  });
  drawTableHeader(ctx);

  let zebra = 0;
  for (let i = 0; i < input.rows.length; i += 1) {
    // Vor jeder Zeile prüfen: passt sie noch + Summenzeile + Footer auf die Seite?
    const reserved = (i === input.rows.length - 1 ? SUM_ROW_H + ROW_H : ROW_H) + FOOTER_H + 4;
    if (ctx.y - reserved < MARGIN_BOTTOM) {
      drawFooter(ctx);
      ctx = newPage(doc, { regular, bold }, logo);
      drawTableHeader(ctx);
      zebra = 0;
    }
    drawRow(ctx, i + 1, input.rows[i], zebra);
    zebra += 1;
  }

  const sum = input.rows.reduce((acc, r) => acc + (r.fahrer_honorar ?? 0), 0);
  // Summenzeile braucht Platz — ggf. neue Seite.
  if (ctx.y - SUM_ROW_H - FOOTER_H < MARGIN_BOTTOM) {
    drawFooter(ctx);
    ctx = newPage(doc, { regular, bold }, logo);
    drawTableHeader(ctx);
  }
  drawSumRow(ctx, sum);
  drawFooter(ctx);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
