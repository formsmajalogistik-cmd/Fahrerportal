// E-Rechnung (Phase 1a, Prototyp) — öffentliche Schnittstelle.
export * from './typen';
export { erzeugeCii, pruefeUnterstuetzt, betrag, menge } from './cii';
export { pruefeERechnung, hatFehler, type Mangel } from './pruefung';
export {
  bildeERechnung, ladeERechnungQuelle, bildeERechnungGutschrift, ladeGutschriftQuelle, EINHEIT_STUECK,
  type ERechnungQuelle, type GutschriftQuelle, type Abbildung,
} from './ausRechnung';
export * from './stammdaten';

/** Dateiname für den Test-Export: Re_26/1234 → Re_26_1234_TEST.xml (ZUGFeRD: …_TEST.pdf) */
export function testDateiname(rechnungsnummer: string, endung: 'xml' | 'pdf' = 'xml'): string {
  const sicher = rechnungsnummer.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Rechnung';
  return `${sicher}_TEST.${endung}`;
}
