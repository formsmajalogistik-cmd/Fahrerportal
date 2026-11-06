// Erzeugt aus den Testrechnungen die XML-Dateien (für den Validator).
import { bildeERechnung, bildeERechnungGutschrift } from '../../src/lib/erechnung/ausRechnung';
import { erzeugeCii } from '../../src/lib/erechnung/cii';
import { pruefeERechnung, type Mangel } from '../../src/lib/erechnung/pruefung';
import { MIT_ECHTEN_FIRMENDATEN, TEST_FIRMA, testrechnungen, type Testrechnung } from './testrechnungen';
import { FIRMENDATEN } from '../../src/lib/firmendaten';

export interface Testdatei extends Omit<Testrechnung, 'quelle'> {
  xml: string;
  maengel: Mangel[];
}

export function erzeugeTestdateien(): Testdatei[] {
  const dateien = testrechnungen().map((t) => {
    const firma = MIT_ECHTEN_FIRMENDATEN.has(t.name) ? FIRMENDATEN : TEST_FIRMA;
    const { daten, hinweise, abbruch } = t.gutschrift
      ? bildeERechnungGutschrift(t.gutschrift, { firma })
      : bildeERechnung(t.quelle!, { firma });
    if (abbruch) throw new Error(`${t.name}: ${abbruch}`);
    const { quelle: _q, gutschrift: _g, ...rest } = t;
    void _q; void _g;
    return {
      ...rest,
      xml: erzeugeCii(daten, t.profil),
      maengel: [...hinweise, ...pruefeERechnung(daten, t.profil)],
    };
  });

  // Gegenproben mit gezielt beschädigter Datei: belegen, dass auch die
  // CEN-Regeln, die Codelisten und das XML-Schema tatsächlich greifen.
  const basis = dateien.find((d) => d.name === '01_ab_tour')!;
  const kaputt = (name: string, beschreibung: string, regel: string, von: RegExp, nach: string): Testdatei => {
    const xml = basis.xml.replace(von, nach);
    if (xml === basis.xml) throw new Error(`${name}: Ersetzung griff nicht`);
    return { ...basis, name, beschreibung, xml, erwartung: 'ungueltig', erwarteteRegeln: [regel], maengel: [] };
  };
  dateien.push(
    kaputt('09_gegenprobe_summe_falsch', 'Gegenprobe: Gesamtbetrag verfälscht', 'BR-CO-15',
      /<ram:GrandTotalAmount>([\d.]+)<\/ram:GrandTotalAmount>/, '<ram:GrandTotalAmount>999.99</ram:GrandTotalAmount>'),
    kaputt('10_gegenprobe_land_falsch', 'Gegenprobe: ungültiger Ländercode', 'BR-CL-14',
      /<ram:CountryID>DE<\/ram:CountryID>/, '<ram:CountryID>XX</ram:CountryID>'),
    kaputt('11_gegenprobe_schema', 'Gegenprobe: unbekanntes Element (XML-Schema)', 'XSD',
      /<ram:LineID>1<\/ram:LineID>/, '<ram:LineID>1</ram:LineID><ram:Unbekannt>x</ram:Unbekannt>'),
  );
  return dateien;
}
