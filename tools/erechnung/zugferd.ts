// Erzeugt aus den Testrechnungen ZUGFeRD-Dateien (PDF/A-3b mit
// eingebettetem XML, Profil EN 16931) — über genau denselben Weg wie die
// App: bildeERechnung → erzeugeCii → rechnungPdfInputAus → generateRechnungPdf.
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { bildeERechnung, bildeERechnungGutschrift } from '../../src/lib/erechnung/ausRechnung';
import { erzeugeCii } from '../../src/lib/erechnung/cii';
import { gutschriftPdfInputAus, rechnungPdfInputAus } from '../../src/lib/erechnung/belegPdf';
import { leseZugferdXml } from '../../src/lib/erechnung/zugferd';
import { generateRechnungPdf } from '../../src/pages/admin/rechnungen/rechnungPdf';
import { TEST_FIRMA, testrechnungen } from './testrechnungen';

/** Testfälle laut Vorgabe (Phase 1c, Punkt 7). */
export const ZUGFERD_FAELLE = [
  '01_ab_tour', '02_aba_tour', '03_zwei_steuersaetze', '04_manuell_zahlungsziel', '05_sonderzeichen',
  '12_mehrtaegige_tour', '16_lange_rechnung', '14_storno_381', '15_teilgutschrift_381',
];

export interface ZugferdDatei {
  name: string;
  beschreibung: string;
  pdf: Uint8Array;
  /** Das erzeugte XML (zum Vergleich mit dem eingebetteten). */
  xml: string;
  eingebettet: string | null;
  seiten: number;
}

export async function erzeugeZugferdDateien(wurzel: string, mitBildern = true): Promise<ZugferdDatei[]> {
  const logo = readFileSync(`${wurzel}/public/Firmenlogo.png`);
  (globalThis as { fetch?: unknown }).fetch = async (u: string) => ({
    ok: String(u).includes('Firmenlogo'),
    arrayBuffer: async () => logo.buffer.slice(logo.byteOffset, logo.byteOffset + logo.byteLength),
  });
  const schriften = {
    regular: new Uint8Array(readFileSync(`${wurzel}/public/fonts/LiberationSans-Regular.ttf`)),
    bold: new Uint8Array(readFileSync(`${wurzel}/public/fonts/LiberationSans-Bold.ttf`)),
  };
  // Stempel/Unterschrift: PNG mit Transparenz (hier das Logo als Platzhalter).
  const bild = `data:image/png;base64,${logo.toString('base64')}`;
  const bilder = mitBildern ? { unterschrift: bild, stempel: bild } : undefined;
  const erstellt = new Date('2026-11-10T10:00:00Z');
  const alle = testrechnungen();
  const out: ZugferdDatei[] = [];
  for (const name of ZUGFERD_FAELLE) {
    const t = alle.find((x) => x.name === name)!;
    let xml: string;
    let blob: Blob;
    if (t.gutschrift) {
      const { daten } = bildeERechnungGutschrift(t.gutschrift, { firma: TEST_FIRMA });
      xml = erzeugeCii(daten, 'en16931');
      blob = await generateRechnungPdf(gutschriftPdfInputAus({
        gutschrift: t.gutschrift.gutschrift, positionen: t.gutschrift.positionen, auftraggeber: t.gutschrift.auftraggeber,
        firma: TEST_FIRMA, ausSnapshot: true, erechnung: daten, bilder,
        dokumentbezeichnung: 'Gutschrift', summenLabel: 'Gutschriftbetrag',
        zugferd: { xml, schriften, fontkit, erstellt },
      }));
    } else {
      const { daten } = bildeERechnung(t.quelle!, { firma: TEST_FIRMA });
      xml = erzeugeCii(daten, 'en16931');
      blob = await generateRechnungPdf(rechnungPdfInputAus({
        rechnung: t.quelle!.rechnung, positionen: t.quelle!.positionen, auftraggeber: t.quelle!.auftraggeber,
        firma: TEST_FIRMA, ausSnapshot: true, erechnung: daten, bilder,
        zugferd: { xml, schriften, fontkit, erstellt },
      }));
    }
    const pdf = new Uint8Array(await blob.arrayBuffer());
    const seiten = (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    out.push({ name, beschreibung: t.beschreibung, pdf, xml, eingebettet: await leseZugferdXml(pdf), seiten });
  }
  return out;
}
