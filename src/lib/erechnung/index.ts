// E-Rechnung (Phase 1a, Prototyp) — öffentliche Schnittstelle.
export * from './typen';
export { erzeugeCii, pruefeUnterstuetzt, betrag, menge } from './cii';
export { pruefeERechnung, hatFehler, type Mangel } from './pruefung';
export { bildeERechnung, ladeERechnungQuelle, type ERechnungQuelle, type Abbildung } from './ausRechnung';
export * from './stammdaten';

/** Dateiname für den Test-Export: Re_26/1234 → Re_26_1234_TEST.xml */
export function testDateiname(rechnungsnummer: string): string {
  const sicher = rechnungsnummer.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Rechnung';
  return `${sicher}_TEST.xml`;
}
