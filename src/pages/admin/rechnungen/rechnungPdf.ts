import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { berechneSummenProUst, type UstGroup } from '../../../lib/rechnungsformat';

// ============================================================
// Maja-Logistik Rechnungs-PDF
// Layout: A4 Hochformat, Navy-Header mit Logo + "Rechnung"-Titel,
// Empfänger links + Meta rechts, Positionstabelle mit Unterzeilen,
// USt-Block (1 oder mehrere Sätze), Fußzeile mit Bankdaten.
// ============================================================

// ----- Design-System (Maja Navy/Accent/Light) -----
const NAVY      = rgb(0x1B / 255, 0x3A / 255, 0x5C / 255);
const WHITE     = rgb(1, 1, 1);
const INK       = rgb(0.12, 0.16, 0.22);
const MUTED     = rgb(0.45, 0.50, 0.55);
const FAINT     = rgb(0.78, 0.81, 0.85);
const SEPARATOR = rgb(0.85, 0.87, 0.90);

// ----- Hardcoded Absender-Daten (Aufgabe-Briefing) -----
const ABSENDER = {
  name: 'Maja-Logistik M.Janßen',
  strasse: 'Heiligenroder Strasse 38e',
  plzOrt: '28816 Stuhr-Heiligenrode',
  tel: '+49 17641461645',
  email: 'info@maja-logistik.de',
  uid: 'DE309356726',
  iban: 'DE04280501000001429760',
  bic: 'SLZODE22XXX',
};

// ----- Geometrie -----
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN_X = 36;          // 12 mm
const MARGIN_BOTTOM = 24;

const HEADER_H = 56;
const FOOTER_H = 36;
const TBL_HEAD_H = 22;
const ROW_BASE_H = 18;        // pro Hauptzeile
const ROW_SUB_H  = 11;        // pro Unterzeile

// Spalten-Verteilung
const COL = {
  pos:     28,
  menge:   60,
  einzel:  80,
  gesamt:  90,
  ust:     46,
};
const TABLE_W = A4_W - 2 * MARGIN_X;
const COL_BEZ = TABLE_W - COL.pos - COL.menge - COL.einzel - COL.gesamt - COL.ust;

// ----- Eingabe-Datenmodelle -----
export interface RechnungPdfPosition {
  position_nr: number;
  bezeichnung: string;
  unterzeilen: string[];
  menge: number;
  einzelpreis: number;
  gesamtpreis: number;
  ust_satz: number | null;
}

export interface RechnungPdfInput {
  rechnungsnummer: string;
  datum: string;            // YYYY-MM-DD
  anrede: string | null;
  kundennummer: string | null;
  sachbearbeiter: string | null;
  /** ggf. fällig-Datum (YYYY-MM-DD) — nur wenn berechenbar. */
  faelligAm: string | null;
  /** Adress-Snapshot vom Rechnungs-Datensatz. */
  empfaenger: {
    firma: string | null;
    ansprechpartner: string | null;
    strasse: string | null;
    plz_ort: string | null;
    land: string | null;
  };
  /** Auftraggeber-UID — wird im Summen-Block angezeigt, falls vorhanden. */
  kundenUid: string | null;
  /** Optional aus den Auftraggeber-Stammdaten — fließt in den
   *  Footer-Hinweis "Zahlungsziel: N Tage" ein. */
  zahlungszielTage: number | null;
  ustSatzDefault: number;
  positionen: RechnungPdfPosition[];
}

// ============================================================
// Helpers
// ============================================================

function formatDateDe(iso: string | null): string {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatEur(n: number): string {
  const v = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  return v.replace(/\B(?=(\d{3})+(?=,))/g, '.') + ' €';
}

function formatEurPlain(n: number): string {
  const v = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  return v.replace(/\B(?=(\d{3})+(?=,))/g, '.');
}

function formatMenge(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

function formatPercent(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * WinAnsi-sicherer Text — die Standard-Schriften (Helvetica) decken
 * nur einen kleinen Unicode-Bereich ab. Sonderzeichen wie → werden
 * gemappt; alles außerhalb 0x20..0xFF ersetzen wir mit "?".
 */
function winAnsi(s: string): string {
  return s
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[•·]/g, '*')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xFF]/g, '?');
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const resp = await fetch('/Firmenlogo.png');
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch { return null; }
}

interface Fonts { regular: PDFFont; bold: PDFFont }

interface PageCtx {
  page: PDFPage;
  fonts: Fonts;
  logo: PDFImage | null;
  /** pdf-lib-y-Cursor (Ursprung unten links). */
  y: number;
}

function drawHeader(ctx: PageCtx) {
  const { page, fonts, logo } = ctx;
  // Navy-Streifen
  page.drawRectangle({
    x: 0, y: A4_H - HEADER_H,
    width: A4_W, height: HEADER_H,
    color: NAVY,
  });
  // Logo links — proportional einpassen
  if (logo) {
    const targetH = 32;
    const ratio = logo.width / logo.height;
    const w = targetH * ratio;
    page.drawImage(logo, {
      x: MARGIN_X,
      y: A4_H - HEADER_H + (HEADER_H - targetH) / 2,
      width: w, height: targetH,
    });
  }
  // Titel rechts
  const title = 'Rechnung';
  const size = 20;
  const tw = fonts.bold.widthOfTextAtSize(title, size);
  page.drawText(title, {
    x: A4_W - MARGIN_X - tw,
    y: A4_H - HEADER_H / 2 - size / 3,
    size, font: fonts.bold, color: WHITE,
  });
  ctx.y = A4_H - HEADER_H - 8;
}

function drawFooter(ctx: PageCtx) {
  const { page, fonts } = ctx;
  const lines = [
    'Maja-Logistik',
    'Heiligenroder Strasse 38e 28816 Stuhr',
    `Tel.:${ABSENDER.tel} ${ABSENDER.email}`,
    `UID: ${ABSENDER.uid}  IBAN: ${ABSENDER.iban}  BIC: ${ABSENDER.bic}`,
  ];
  let y = MARGIN_BOTTOM - 2;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = winAnsi(lines[i]);
    const w = fonts.regular.widthOfTextAtSize(text, 7);
    page.drawText(text, {
      x: (A4_W - w) / 2, y, size: 7, font: fonts.regular, color: MUTED,
    });
    y += 9;
  }
}

function drawAbsenderRechts(ctx: PageCtx) {
  // Absender-Block oben rechts in 8 pt Navy.
  const { page, fonts } = ctx;
  const lines = [
    ABSENDER.name,
    ABSENDER.strasse,
    ABSENDER.plzOrt,
    `Tel.:${ABSENDER.tel}`,
    ABSENDER.email,
    `UID:${ABSENDER.uid}`,
  ];
  const size = 8;
  // Beginnt unmittelbar unter dem Navy-Header.
  let y = ctx.y;
  for (const raw of lines) {
    const text = winAnsi(raw);
    const w = fonts.regular.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: A4_W - MARGIN_X - w, y,
      size, font: fonts.regular, color: NAVY,
    });
    y -= size + 2;
  }
  ctx.y = y - 4;
}

function drawAbsenderzeile(ctx: PageCtx) {
  // Sehr kleine Abs.-Zeile über dem Empfängerblock.
  const { page, fonts } = ctx;
  const text = winAnsi(
    `Abs.: ${ABSENDER.name} | ${ABSENDER.strasse} | ${ABSENDER.plzOrt}`,
  );
  page.drawText(text, {
    x: MARGIN_X, y: ctx.y,
    size: 6.5, font: fonts.regular, color: MUTED,
  });
  // Dünne Unterlinie unter dem Abs.-Block
  page.drawLine({
    start: { x: MARGIN_X, y: ctx.y - 2 },
    end:   { x: MARGIN_X + 260, y: ctx.y - 2 },
    thickness: 0.3, color: FAINT,
  });
  ctx.y -= 14;
}

function drawEmpfaengerUndMeta(ctx: PageCtx, input: RechnungPdfInput) {
  const { page, fonts } = ctx;
  // --- Empfänger links ---
  const startY = ctx.y;
  const empfLines: string[] = [];
  const a = input.empfaenger;
  if (a.firma) empfLines.push(a.firma);
  if (a.ansprechpartner) empfLines.push(a.ansprechpartner);
  if (a.strasse) empfLines.push(a.strasse);
  if (a.plz_ort) empfLines.push(a.plz_ort);
  if (a.land) empfLines.push(a.land);
  let yL = startY;
  for (let i = 0; i < empfLines.length; i += 1) {
    page.drawText(winAnsi(empfLines[i]), {
      x: MARGIN_X, y: yL,
      size: i === 0 ? 11 : 10,
      font: i === 0 ? fonts.bold : fonts.regular,
      color: INK,
    });
    yL -= i === 0 ? 14 : 13;
  }

  // --- Meta rechts ---
  const metaLines: Array<[string, string]> = [];
  metaLines.push(['Rechnung:', input.rechnungsnummer]);
  metaLines.push(['Datum:', formatDateDe(input.datum)]);
  if (input.sachbearbeiter) metaLines.push(['Sachbearbeiter:', input.sachbearbeiter]);
  if (input.faelligAm) metaLines.push(['fällig am:', formatDateDe(input.faelligAm)]);
  if (input.kundennummer) metaLines.push(['Kundennummer:', input.kundennummer]);

  let yR = startY;
  for (const [label, value] of metaLines) {
    const labelText = winAnsi(label);
    const valueText = winAnsi(value);
    const valSize = 10;
    const lblSize = 9.5;
    const valW = fonts.bold.widthOfTextAtSize(valueText, valSize);
    page.drawText(valueText, {
      x: A4_W - MARGIN_X - valW, y: yR,
      size: valSize, font: fonts.bold, color: INK,
    });
    const lblW = fonts.regular.widthOfTextAtSize(labelText, lblSize);
    page.drawText(labelText, {
      x: A4_W - MARGIN_X - valW - 6 - lblW, y: yR,
      size: lblSize, font: fonts.regular, color: MUTED,
    });
    yR -= 14;
  }
  ctx.y = Math.min(yL, yR) - 10;
}

function drawTitelUndAnrede(ctx: PageCtx, input: RechnungPdfInput) {
  const { page, fonts } = ctx;
  // "Rechnungsnummer" als linker Titel-Unterzeile, fett+unterstrichen.
  const nrText = winAnsi(input.rechnungsnummer);
  const nrSize = 12;
  const nrW = fonts.bold.widthOfTextAtSize(nrText, nrSize);
  page.drawText(nrText, {
    x: MARGIN_X, y: ctx.y,
    size: nrSize, font: fonts.bold, color: NAVY,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: ctx.y - 2 },
    end:   { x: MARGIN_X + nrW, y: ctx.y - 2 },
    thickness: 0.6, color: NAVY,
  });
  ctx.y -= 22;
  if (input.anrede) {
    page.drawText(winAnsi(input.anrede), {
      x: MARGIN_X, y: ctx.y,
      size: 10, font: fonts.regular, color: INK,
    });
    ctx.y -= 18;
  }
}

function drawTableHeader(ctx: PageCtx) {
  const { page, fonts, y } = ctx;
  page.drawRectangle({
    x: MARGIN_X, y: y - TBL_HEAD_H,
    width: TABLE_W, height: TBL_HEAD_H,
    color: NAVY,
  });
  const cellY = y - TBL_HEAD_H / 2 - 4;
  let x = MARGIN_X;
  // Pos.
  page.drawText('Pos.', {
    x: x + (COL.pos - fonts.bold.widthOfTextAtSize('Pos.', 9.5)) / 2,
    y: cellY, size: 9.5, font: fonts.bold, color: WHITE,
  });
  x += COL.pos;
  // Bezeichnung
  page.drawText('Bezeichnung', {
    x: x + 4, y: cellY, size: 9.5, font: fonts.bold, color: WHITE,
  });
  x += COL_BEZ;
  // Menge / Einzelpreis / Gesamtpreis / USt rechtsbündig
  const headRight = (label: string, w: number) => {
    const lw = fonts.bold.widthOfTextAtSize(label, 9.5);
    page.drawText(label, {
      x: x + w - 6 - lw, y: cellY, size: 9.5, font: fonts.bold, color: WHITE,
    });
    x += w;
  };
  headRight('Menge', COL.menge);
  headRight('Einzelpreis', COL.einzel);
  headRight('Gesamtpreis', COL.gesamt);
  headRight('USt', COL.ust);
  ctx.y = y - TBL_HEAD_H;
}

function positionHeight(p: RechnungPdfPosition): number {
  return ROW_BASE_H + p.unterzeilen.length * ROW_SUB_H;
}

function drawPosition(
  ctx: PageCtx,
  p: RechnungPdfPosition,
  defaultUst: number,
) {
  const { page, fonts } = ctx;
  const totalH = positionHeight(p);
  const topY = ctx.y;
  const baseY = topY - 12;

  // Pos-Nummer (zentriert, Navy)
  const posText = String(p.position_nr);
  const posW = fonts.regular.widthOfTextAtSize(posText, 9.5);
  page.drawText(posText, {
    x: MARGIN_X + (COL.pos - posW) / 2, y: baseY,
    size: 9.5, font: fonts.regular, color: NAVY,
  });

  // Bezeichnung links
  const xBez = MARGIN_X + COL.pos + 4;
  page.drawText(winAnsi(p.bezeichnung), {
    x: xBez, y: baseY, size: 10, font: fonts.regular, color: INK,
  });
  // Unterzeilen — eingerückt, kleiner, grauer
  let subY = baseY - ROW_SUB_H;
  for (const u of p.unterzeilen) {
    if (u !== '') {
      page.drawText(winAnsi(u), {
        x: xBez + 8, y: subY,
        size: 8.5, font: fonts.regular, color: MUTED,
      });
    }
    subY -= ROW_SUB_H;
  }

  // Rechte Spalten: Menge / Einzel / Gesamt / USt
  let xR = MARGIN_X + COL.pos + COL_BEZ;
  const drawRight = (text: string, w: number, opts?: { color?: ReturnType<typeof rgb>; bold?: boolean; size?: number }) => {
    const sz = opts?.size ?? 10;
    const font = opts?.bold ? fonts.bold : fonts.regular;
    const tw = font.widthOfTextAtSize(text, sz);
    page.drawText(text, {
      x: xR + w - 6 - tw, y: baseY, size: sz, font, color: opts?.color ?? INK,
    });
    xR += w;
  };
  drawRight(formatMenge(p.menge), COL.menge);
  drawRight(formatEurPlain(p.einzelpreis), COL.einzel);
  drawRight(formatEur(p.gesamtpreis), COL.gesamt, { bold: true });

  // USt-Anzeige: Standard-Satz grau, abweichender Satz fett-Accent.
  const eff = p.ust_satz != null ? Number(p.ust_satz) : defaultUst;
  const isOverride = p.ust_satz != null && Number(p.ust_satz) !== defaultUst;
  drawRight(`${formatPercent(eff)} %`, COL.ust, {
    color: isOverride ? NAVY : MUTED,
    bold: isOverride,
    size: 9,
  });

  // Untere Trennlinie
  const bottomY = topY - totalH;
  page.drawLine({
    start: { x: MARGIN_X,           y: bottomY },
    end:   { x: MARGIN_X + TABLE_W, y: bottomY },
    thickness: 0.3, color: SEPARATOR,
  });
  ctx.y = bottomY;
}

function drawSummenBlock(ctx: PageCtx, groups: UstGroup[], summen: { netto: number; ust: number; brutto: number }, input: RechnungPdfInput) {
  const { page, fonts } = ctx;
  // Dicke Trennlinie
  page.drawLine({
    start: { x: MARGIN_X,           y: ctx.y - 4 },
    end:   { x: MARGIN_X + TABLE_W, y: ctx.y - 4 },
    thickness: 1, color: NAVY,
  });
  ctx.y -= 14;

  // Links: Meta-Hinweise (UID, Leistungsdatum, Zahlungsziel)
  let leftY = ctx.y;
  const drawLeft = (label: string) => {
    page.drawText(winAnsi(label), {
      x: MARGIN_X, y: leftY,
      size: 8.5, font: fonts.regular, color: MUTED,
    });
    leftY -= 11;
  };
  if (input.kundenUid) drawLeft(`Ihre UID: ${input.kundenUid}`);
  drawLeft('Leistungsdatum = Datum des Fahrauftrages');
  if (input.zahlungszielTage != null) drawLeft(`Zahlungsziel: ${input.zahlungszielTage} Tage`);

  // Rechts: Summen — pro USt-Satz eine Zeile bei multi-VAT, sonst eine.
  let rightY = ctx.y;
  const lineRight = (label: string, value: string, opts?: { bold?: boolean; underline?: boolean; size?: number }) => {
    const sz = opts?.size ?? 10;
    const fnt = opts?.bold ? fonts.bold : fonts.regular;
    const valueW = fnt.widthOfTextAtSize(value, sz);
    const xVal = A4_W - MARGIN_X - valueW;
    page.drawText(value, {
      x: xVal, y: rightY,
      size: sz, font: fnt, color: INK,
    });
    const lblW = fonts.regular.widthOfTextAtSize(label, sz);
    page.drawText(label, {
      x: xVal - 12 - lblW, y: rightY,
      size: sz, font: fonts.regular, color: opts?.bold ? NAVY : MUTED,
    });
    if (opts?.underline) {
      page.drawLine({
        start: { x: xVal, y: rightY - 2 },
        end:   { x: xVal + valueW, y: rightY - 2 },
        thickness: 0.7, color: NAVY,
      });
    }
    rightY -= sz + 4;
  };

  lineRight('Netto:', formatEur(summen.netto));
  if (groups.length <= 1) {
    const g = groups[0];
    if (g) lineRight(`${formatPercent(g.satz)}% USt.:`, formatEur(g.ust));
  } else {
    for (const g of groups) {
      lineRight(
        `${formatPercent(g.satz)}% USt. auf ${formatEurPlain(g.netto)}:`,
        formatEur(g.ust),
      );
    }
  }
  lineRight('Brutto:', formatEur(summen.brutto), { bold: true, underline: true, size: 11 });

  ctx.y = Math.min(leftY, rightY) - 6;
}

function drawAbschluss(ctx: PageCtx) {
  const { page, fonts } = ctx;
  ctx.y -= 18;
  page.drawText(winAnsi('mit freundlichen Grüßen'), {
    x: MARGIN_X, y: ctx.y, size: 10, font: fonts.regular, color: INK,
  });
  ctx.y -= 30;
  page.drawText(winAnsi('M.Janßen, Maja-Logistik'), {
    x: MARGIN_X, y: ctx.y, size: 10, font: fonts.regular, color: INK,
  });
  ctx.y -= 14;
}

function newPage(doc: PDFDocument, fonts: Fonts, logo: PDFImage | null): PageCtx {
  const page = doc.addPage([A4_W, A4_H]);
  const ctx: PageCtx = { page, fonts, logo, y: A4_H - HEADER_H - 8 };
  drawHeader(ctx);
  drawFooter(ctx);
  return ctx;
}

// ============================================================
// Öffentliche API
// ============================================================

export async function generateRechnungPdf(input: RechnungPdfInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { regular, bold };

  const logoBytes = await fetchLogoBytes();
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  // Seite 1 mit komplettem Kopf + Tabellen-Header + erste Positionen.
  let ctx = newPage(doc, fonts, logo);
  drawAbsenderRechts(ctx);
  // Nach dem Absender-Block den Cursor wieder nach oben links versetzen,
  // damit Empfänger + Meta auf gleicher Höhe stehen.
  ctx.y = A4_H - HEADER_H - 10 - 6 * 10 - 12;
  drawAbsenderzeile(ctx);
  drawEmpfaengerUndMeta(ctx, input);
  drawTitelUndAnrede(ctx, input);
  drawTableHeader(ctx);

  // Positionen — bei Bedarf Seitenumbruch, Header auf jeder Folgeseite wiederholen.
  for (let i = 0; i < input.positionen.length; i += 1) {
    const p = input.positionen[i];
    const needed = positionHeight(p);
    // Auf der letzten Position reservieren wir zusätzlich Platz für den
    // Summen-Block (~ 90 pt) plus Abschluss (~ 60 pt).
    const tail = (i === input.positionen.length - 1) ? 150 : 0;
    if (ctx.y - needed - FOOTER_H - tail < MARGIN_BOTTOM) {
      ctx = newPage(doc, fonts, logo);
      drawTableHeader(ctx);
    }
    drawPosition(ctx, p, input.ustSatzDefault);
  }

  // Summen + Abschluss — bei knappem Platz neue Seite.
  const sum = berechneSummenProUst(
    input.positionen.map((p) => ({ gesamtpreis: p.gesamtpreis, ust_satz: p.ust_satz })),
    input.ustSatzDefault,
  );
  const summenH = 30 + Math.max(sum.groups.length, 1) * 16 + 60;
  if (ctx.y - summenH - FOOTER_H < MARGIN_BOTTOM) {
    ctx = newPage(doc, fonts, logo);
  }
  drawSummenBlock(ctx, sum.groups, sum, input);
  drawAbschluss(ctx);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}

/** Erzeugt einen sauberen Dateinamen aus der Rechnungsnummer ("Re-2026/349" → "Re-2026_349.pdf"). */
export function rechnungPdfFilename(rechnungsnummer: string): string {
  const safe = rechnungsnummer.replace(/[\\/:*?"<>|]/g, '_');
  return `${safe}.pdf`;
}
