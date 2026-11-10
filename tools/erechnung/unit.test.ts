// Unit-Tests E-Rechnung (ohne Validator). Ausführen: npm run test:erechnung
import assert from 'node:assert/strict';
import { bildeERechnung } from '../../src/lib/erechnung/ausRechnung';
import { erzeugeCii, betrag, menge } from '../../src/lib/erechnung/cii';
import { pruefeERechnung, hatFehler } from '../../src/lib/erechnung/pruefung';
import { escapeAttr, escapeText } from '../../src/lib/erechnung/xml';
import { landZuIso, normLandCode, trennePlzOrt } from '../../src/lib/erechnung/stammdaten';
import { ERechnungAbbruch, TYP_CODE_KORREKTUR } from '../../src/lib/erechnung/typen';
import { testDateiname } from '../../src/lib/erechnung';
import { berechneSummenProUst } from '../../src/lib/rechnungsformat';
import { generateRechnungPdf } from '../../src/pages/admin/rechnungen/rechnungPdf';
import { FIRMENDATEN } from '../../src/lib/firmendaten';
import { TEST_FIRMA, testrechnungen } from './testrechnungen';
import { bildeERechnungGutschrift } from '../../src/lib/erechnung/ausRechnung';
import { gutschriftPdfInputAus, rechnungPdfInputAus } from '../../src/lib/erechnung/belegPdf';
import { firmendatenZuJson, pruefeFirmendaten } from '../../src/lib/firmendaten';
import { fusszeilen } from '../../src/pages/admin/rechnungen/rechnungPdf';
import { baueCsv, baueZip, dateienVon, monatsGrenzen, sha256Hex, type ExportEintrag } from '../../src/lib/erechnung/export';
import { srgbIccProfil, xmpPaket } from '../../src/lib/erechnung/zugferd';
import { LIEFERDATUM_IM_KOPF } from '../../src/lib/erechnung/typen';
import { erzeugeZugferdDateien } from './zugferd';

type Fall = { name: string; fn: () => void | Promise<void> };
const faelle: Fall[] = [];
const test = (name: string, fn: Fall['fn']) => faelle.push({ name, fn });

const ALLE = testrechnungen();
const T = Object.fromEntries(ALLE.filter((t) => t.quelle).map((t) => [t.name, { ...t, quelle: t.quelle! }]));
const G = Object.fromEntries(ALLE.filter((t) => t.gutschrift).map((t) => [t.name, t.gutschrift!]));
const bild = (name: string, firma = TEST_FIRMA) => bildeERechnung(T[name].quelle, { firma });
const texte = (m: { text: string }[]) => m.map((x) => x.text);

// ---------------------------------------------------------------- Escaping
test('XML-Escaping: Text und Attribute', () => {
  assert.equal(escapeText('A & B <C> "D"'), 'A &amp; B &lt;C&gt; "D"');
  assert.equal(escapeAttr(`a"b'c<d>&`), 'a&quot;b&apos;c&lt;d&gt;&amp;');
  assert.equal(escapeText('a\u0001b'), 'ab', 'verbotene Steuerzeichen entfernt');
});

test('Sonderzeichen-Rechnung: nichts Unescaptes im XML', () => {
  const { daten } = bild('05_sonderzeichen');
  const xml = erzeugeCii(daten, 'xrechnung');
  assert.ok(xml.includes('Müller &amp; Söhne &lt;Logistik&gt; "Nord" GmbH'));
  assert.ok(xml.includes('Überführung „Bremen" → &lt;Kiel&gt; &amp; zurück'));
  assert.ok(xml.includes("Frau Zoë O'Brien-Jäger"));
  assert.ok(!xml.includes('<Logistik>') && !xml.includes('<Kiel>') && !xml.includes('<Hinterhaus>'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), 'jedes & ist eine Entity');
});

// ---------------------------------------------------------------- Formate
test('Betrags-, Mengen- und Dateinamen-Format', () => {
  assert.equal(betrag(211.2), '211.20');
  assert.equal(betrag(-0.001), '0.00');
  assert.equal(menge(1), '1');
  assert.equal(menge(1.5), '1.5');
  assert.equal(testDateiname('Re_26/1234'), 'Re_26_1234_TEST.xml');
});

// ---------------------------------------------------------------- Abbrüche
test('Dokumentart: 381 nur mit Bezug, andere Codes abgelehnt', () => {
  const { daten } = bild('01_ab_tour');
  assert.throws(() => erzeugeCii({ ...daten, typ: '384' as '380' }), ERechnungAbbruch);
  assert.throws(() => erzeugeCii({ ...daten, typ: TYP_CODE_KORREKTUR }), /Bezug auf die Originalrechnung/);
  assert.equal(TYP_CODE_KORREKTUR, '381');
});

test('Auslagenrechnung mit 19 % (Inland) ist erzeugbar', () => {
  const t = T['13_auslagen_inland_19'];
  const r = bildeERechnung(t.quelle, { firma: TEST_FIRMA });
  assert.equal(r.abbruch, null);
  assert.ok(erzeugeCii(r.daten, 'en16931').includes('<ram:TypeCode>380</ram:TypeCode>'));
});

test('Abbruch: Position mit 0 % (Kategorie nicht freigegeben)', () => {
  const t = T['01_ab_tour'];
  const p0 = { ...t.quelle.positionen[0], ust_satz: 0 };
  const { daten } = bildeERechnung({ ...t.quelle, positionen: [p0] }, { firma: TEST_FIRMA });
  assert.throws(() => erzeugeCii(daten), /S3\/S4/);
  assert.ok(texte(pruefeERechnung(daten)).some((x) => /noch nicht freigegeben/.test(x)));
});

// ---------------------------------------------------------------- Beträge
test('Summen stammen aus berechneSummenProUst (wie das PDF)', () => {
  for (const name of Object.keys(T)) {
    const q = T[name].quelle;
    const { daten } = bildeERechnung(q, { firma: TEST_FIRMA });
    const s = berechneSummenProUst(q.positionen.map((p) => ({ gesamtpreis: p.gesamtpreis, ust_satz: p.ust_satz })), Number(q.rechnung.ust_satz));
    assert.deepEqual([daten.summen.netto, daten.summen.ust, daten.summen.brutto], [s.netto, s.ust, s.brutto], name);
    assert.deepEqual(daten.summen.gruppen.map((g) => [g.satz, g.netto, g.ust]), s.groups.map((g) => [g.satz, g.netto, g.ust]), name);
  }
});

test('Zwei Steuersätze: je Satz eine Steuergruppe im XML', () => {
  const { daten } = bild('03_zwei_steuersaetze');
  const xml = erzeugeCii(daten);
  assert.equal((xml.match(/<ram:ApplicableTradeTax>\s*<ram:CalculatedAmount>/g) ?? []).length, 2);
  assert.ok(xml.includes('<ram:RateApplicablePercent>7</ram:RateApplicablePercent>'));
});

test('ABA-Aufschlag steckt im Positionspreis (keine Zu-/Abschläge)', () => {
  const xml = erzeugeCii(bild('02_aba_tour').daten);
  assert.ok(xml.includes('<ram:ChargeAmount>211.20</ram:ChargeAmount>'));
  assert.ok(!xml.includes('SpecifiedTradeAllowanceCharge'));
});

async function pdfText(input: Parameters<typeof generateRechnungPdf>[0]): Promise<string> {
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false });
  const blob = await generateRechnungPdf(input);
  return pdfTextVon(new Uint8Array(await blob.arrayBuffer()));
}
async function pdfTextVon(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createRequire } = await import('node:module');
  const { dirname } = await import('node:path');
  const schriften = `${dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))}/standard_fonts/`;
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, standardFontDataUrl: schriften }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return text;
}
const eur = (n: number) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');

test('PDF-Lesekopie und XML: dieselben Beträge, Daten und Angaben (Rechnungen)', async () => {
  for (const name of ['01_ab_tour', '02_aba_tour', '03_zwei_steuersaetze', '04_manuell_zahlungsziel', '12_mehrtaegige_tour']) {
    const q = T[name].quelle;
    const { daten } = bildeERechnung(q, { firma: TEST_FIRMA });
    const text = await pdfText(rechnungPdfInputAus({
      rechnung: q.rechnung, positionen: q.positionen, auftraggeber: q.auftraggeber,
      firma: TEST_FIRMA, ausSnapshot: true, erechnung: daten,
    }));
    const xml = erzeugeCii(daten);
    const soll = [daten.summen.netto, daten.summen.brutto, ...daten.summen.gruppen.map((g) => g.ust), ...daten.positionen.map((p) => p.netto)];
    for (const n of soll) {
      assert.ok(text.includes(eur(n)), `${name}: PDF enthält ${eur(n)}`);
      assert.ok(xml.includes(`>${betrag(n)}<`), `${name}: XML enthält ${betrag(n)}`);
    }
    for (const p of daten.positionen.filter((x) => x.leistungsdatum)) {
      const [y, m, d] = p.leistungsdatum!.split('-');
      assert.ok(text.includes(`Leistungsdatum: ${d}.${m}.${y}`), `${name}: PDF Leistungsdatum ${p.leistungsdatum}`);
      assert.ok(xml.includes(`>${y}${m}${d}<`), `${name}: XML Leistungsdatum ${p.leistungsdatum}`);
    }
    if (daten.faelligAm) {
      const [y, m, d] = daten.faelligAm.split('-');
      assert.ok(text.includes(`${d}.${m}.${y}`), `${name}: PDF Fälligkeit`);
    }
    if (daten.kaeuferReferenz) assert.ok(text.includes(daten.kaeuferReferenz), `${name}: PDF Käuferreferenz`);
    assert.ok(text.includes('Maßgeblich ist die E-Rechnung'), `${name}: Lesekopie-Hinweis`);
    assert.ok(text.includes('Steuernummer: 12/345/67890') && text.includes('Inhaber: Test Inhaber'), `${name}: Pflichtangaben`);
  }
});

test('Mehrtägige Tour: Leistungsdatum = Abschlusstag in PDF und XML, BG-14 = min/max', async () => {
  const q = T['12_mehrtaegige_tour'].quelle;
  const { daten } = bildeERechnung(q, { firma: TEST_FIRMA });
  assert.deepEqual([daten.leistungVon, daten.leistungBis], ['2026-10-15', '2026-10-20']);
  const xml = erzeugeCii(daten);
  assert.ok(/<ram:LineID>1<\/ram:LineID>[\s\S]*?<ram:BillingSpecifiedPeriod>\s*<ram:StartDateTime>\s*<udt:DateTimeString format="102">20261015</.test(xml));
  assert.equal((xml.match(/<ram:BillingSpecifiedPeriod>/g) ?? []).length, 3, '2 Positionen + Rechnungsebene');
});

test('Normales PDF (ohne E-Rechnung) bleibt beim bisherigen Hinweis', async () => {
  const q = T['01_ab_tour'].quelle;
  const text = await pdfText(rechnungPdfInputAus({ rechnung: q.rechnung, positionen: q.positionen, auftraggeber: q.auftraggeber, firma: TEST_FIRMA, ausSnapshot: false }));
  assert.ok(text.includes('Leistungsdatum = Datum des Fahrauftrages'));
  assert.ok(!text.includes('Leistungsdatum: '));
  assert.ok(!text.includes('Steuernummer'), 'Altlayout ohne Pflichtangaben-Fußzeile');
});

test('Storno (381): Bezug BT-25/26, Lesekopie mit Titel und Bezug', async () => {
  const g = G['14_storno_381'];
  const { daten, abbruch } = bildeERechnungGutschrift(g, { firma: TEST_FIRMA });
  assert.equal(abbruch, null);
  const xml = erzeugeCii(daten, 'xrechnung');
  assert.ok(xml.includes('<ram:TypeCode>381</ram:TypeCode>'));
  assert.ok(/<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>Re_26\/9002<\/ram:IssuerAssignedID>[\s\S]*20261103/.test(xml));
  assert.ok(!/<ram:ChargeAmount>-/.test(xml), 'keine negativen Einzelpreise');
  const text = await pdfText(gutschriftPdfInputAus({ gutschrift: g.gutschrift, positionen: g.positionen, auftraggeber: g.auftraggeber,
    firma: TEST_FIRMA, ausSnapshot: true, erechnung: daten, dokumentbezeichnung: 'Gutschrift', summenLabel: 'Gutschriftbetrag' }));
  assert.ok(text.includes('Stornorechnung') && text.includes('Bezug: Rechnung Re_26/9002 vom 03.11.2026'));
  assert.ok(text.includes(eur(daten.summen.brutto)) && xml.includes(`>${betrag(daten.summen.brutto)}<`));
});

test('Mengeneinheit immer C62 (auch wenn einheit_code gesetzt ist)', () => {
  const xml = erzeugeCii(bild('04_manuell_zahlungsziel').daten);
  assert.ok(xml.includes('unitCode="C62"') && !xml.includes('unitCode="HUR"'));
});

test('Sachbearbeiter des Kunden → Ansprechpartner des Käufers (BG-9)', () => {
  const xml = erzeugeCii(bild('01_ab_tour').daten);
  assert.ok(/<ram:BuyerTradeParty>[\s\S]*<ram:PersonName>Herr Kunde \(Sachbearbeiter\)<\/ram:PersonName>/.test(xml));
  assert.ok(/<ram:SellerTradeParty>[\s\S]*<ram:PersonName>Testkontakt/.test(xml));
});

test('Snapshot am Beleg hat Vorrang vor den aktuellen Firmendaten', () => {
  const t = T['01_ab_tour'];
  const snap = { ...firmendatenZuJson(TEST_FIRMA), ort: 'Snapshot-Ort', kontakt_name: 'Snapshot Kontakt' };
  const { daten } = bildeERechnung({ ...t.quelle, rechnung: { ...t.quelle.rechnung, absender_snapshot: snap } }, { firma: FIRMENDATEN });
  assert.equal(daten.verkaeufer.ort, 'Snapshot-Ort');
  assert.equal(daten.verkaeufer.kontaktName, 'Snapshot Kontakt');
});

test('Fußzeile: Altlayout vs. Pflichtangaben', () => {
  const alt = fusszeilen(FIRMENDATEN, false);
  assert.deepEqual(alt, ['Maja-Logistik', 'Heiligenroder Strasse 38e 28816 Stuhr-Heiligenrode', 'Tel.:+49 17641461645 info@maja-logistik.de', 'UID: DE309356726  IBAN: DE04280501000001429760  BIC: SLZODE22XXX']);
  const neu = fusszeilen({ ...TEST_FIRMA, registergericht: 'Amtsgericht Test', registernummer: 'HRA 1' }, true).join(' | ');
  for (const t of ['Inhaber: Test Inhaber', 'Einzelunternehmen', 'Steuernummer: 12/345/67890', 'Amtsgericht Test HRA 1', 'USt-IdNr.: DE309356726', 'Testbank']) {
    assert.ok(neu.includes(t), t);
  }
});

// ---------------------------------------------------------------- Pflichtfelder
test('Vollständige Testrechnungen: keine Fehler in der Pflichtfeld-Prüfung', () => {
  for (const name of ['01_ab_tour', '02_aba_tour', '03_zwei_steuersaetze', '04_manuell_zahlungsziel', '05_sonderzeichen']) {
    const { daten, hinweise } = bild(name);
    const m = [...hinweise, ...pruefeERechnung(daten, 'xrechnung')];
    assert.equal(hatFehler(m), false, `${name}: ${texte(m.filter((x) => x.schwere === 'fehler')).join('; ')}`);
  }
});

test('Echte Firmendaten: „Kontaktname des Absenders fehlt"', () => {
  const { daten } = bild('01_ab_tour', FIRMENDATEN);
  assert.ok(texte(pruefeERechnung(daten, 'xrechnung')).includes('Kontaktname des Absenders fehlt (Pflicht bei XRechnung)'));
});

test('Fehlende Empfängerangaben werden einzeln benannt', () => {
  const t = T['01_ab_tour'];
  const r = { ...t.quelle.rechnung, rechnungsadresse_plz: null, rechnungsadresse_ort: null, rechnungsadresse_land_code: null, erechnung_email: null, kaeufer_referenz: null };
  const { daten } = bildeERechnung({ ...t.quelle, rechnung: r }, { firma: TEST_FIRMA });
  const m = texte(pruefeERechnung(daten, 'xrechnung'));
  for (const s of ['PLZ des Empfängers fehlt', 'Ort des Empfängers fehlt', 'Ländercode des Empfängers fehlt',
    'E-Rechnungs-Adresse fehlt (Pflicht bei XRechnung)', 'Käuferreferenz fehlt (Pflicht bei XRechnung)']) {
    assert.ok(m.includes(s), `erwartet: ${s}`);
  }
});

test('Profil EN 16931: Käuferreferenz/E-Rechnungs-Adresse nur Hinweis', () => {
  const { daten } = bild('06_en16931_ohne_xrechnung');
  const m = pruefeERechnung(daten, 'en16931');
  assert.equal(hatFehler(m), false, texte(m.filter((x) => x.schwere === 'fehler')).join('; '));
});

test('Test-Ableitung für Altrechnungen (nur mit Option, mit Hinweis)', () => {
  const t = T['01_ab_tour'];
  const alt = { ...t.quelle.rechnung, rechnungsadresse_plz: null, rechnungsadresse_ort: null, rechnungsadresse_land_code: null, rechnungsadresse_land: 'Deutschland' };
  const ohne = bildeERechnung({ ...t.quelle, rechnung: alt }, { firma: TEST_FIRMA });
  assert.equal(ohne.daten.kaeufer.plz, null);
  const mit = bildeERechnung({ ...t.quelle, rechnung: alt }, { firma: TEST_FIRMA, testAbleitung: true });
  assert.deepEqual([mit.daten.kaeufer.plz, mit.daten.kaeufer.ort, mit.daten.kaeufer.landCode], ['28195', 'Bremen', 'DE']);
  assert.ok(mit.hinweise.some((h) => /abgeleitet/.test(h.text)));
});

test('PLZ/Ort-Snapshot weicht vom Adressfeld ab → Fehler', () => {
  const t = T['01_ab_tour'];
  const r = { ...t.quelle.rechnung, rechnungsadresse_plz_ort: '28199 Bremen' };
  const { hinweise } = bildeERechnung({ ...t.quelle, rechnung: r }, { firma: TEST_FIRMA });
  assert.ok(hinweise.some((h) => h.schwere === 'fehler' && /weichen vom Adressfeld/.test(h.text)));
});

test('Manuelle Rechnung ohne Zahlungsziel → Fälligkeit fehlt', () => {
  const t = T['04_manuell_zahlungsziel'];
  const r = { ...t.quelle.rechnung, zahlungsziel_tage: null, faellig_am: null };
  const { daten } = bildeERechnung({ ...t.quelle, rechnung: r }, { firma: TEST_FIRMA });
  assert.ok(texte(pruefeERechnung(daten)).includes('Fälligkeitsdatum bzw. Zahlungsziel fehlt'));
});

test('Negativer Einzelpreis und Rundungsabweichung werden gemeldet', () => {
  const { daten } = bild('01_ab_tour');
  const neg = { ...daten, positionen: [{ ...daten.positionen[0], einzelpreis: -5, netto: -5 }] };
  assert.ok(texte(pruefeERechnung(neg)).some((x) => /negativer Einzelpreis/.test(x)));
  const falsch = { ...daten, summen: { ...daten.summen, gruppen: [{ ...daten.summen.gruppen[0], ust: 36.47 }] } };
  assert.ok(pruefeERechnung(falsch).some((x) => x.bt === 'BR-CO-17'));
});

test('Rechtsform, Register, Steuernummer leer: keine leeren Etiketten im PDF, kein Element im XML, keine Pflicht', () => {
  const ohne = { ...TEST_FIRMA, rechtsform: null, registergericht: null, registernummer: null, steuernummer: null, inhaber: null, bank: null };
  assert.deepEqual(pruefeFirmendaten(ohne), []);
  const zeilen = fusszeilen(ohne, true);
  assert.deepEqual(zeilen, [
    'Maja-Logistik M.Janßen',
    'Heiligenroder Strasse 38e  |  28816 Stuhr-Heiligenrode  |  Tel.: +49 17641461645  |  info@maja-logistik.de',
    'USt-IdNr.: DE309356726',
    'IBAN: DE04280501000001429760  |  BIC: SLZODE22XXX',
  ]);
  for (const z of zeilen) assert.ok(!/(Steuernummer|Inhaber|HR[AB]|Amtsgericht|Rechtsform)/.test(z) && !/\|\s*$|^\s*\|/.test(z) && !/:\s*(\||$)/.test(z), z);
  const { daten } = bildeERechnung(T['01_ab_tour'].quelle, { firma: ohne });
  const xml = erzeugeCii(daten, 'xrechnung');
  assert.ok(!xml.includes('schemeID="FC"') && xml.includes('schemeID="VA">DE309356726'));
  assert.equal(hatFehler(pruefeERechnung(daten, 'xrechnung')), false);
});

test('Fehlende USt-IdNr. des Empfängers → nur Hinweis', () => {
  const t = T['01_ab_tour'];
  const { daten } = bildeERechnung({ ...t.quelle, auftraggeber: { ...t.quelle.auftraggeber!, kunden_uid: null } }, { firma: TEST_FIRMA });
  const m = pruefeERechnung(daten, 'xrechnung').filter((x) => x.bt === 'BT-48');
  assert.equal(m.length, 1);
  assert.equal(m[0].schwere, 'hinweis');
  assert.equal(hatFehler(pruefeERechnung(daten, 'xrechnung')), false);
});

test('EN 16931: ohne Käuferreferenz, E-Rechnungs-Adresse und Kontaktname keine Fehler', () => {
  const t = T['01_ab_tour'];
  const { daten } = bildeERechnung({ ...t.quelle, rechnung: { ...t.quelle.rechnung, kaeufer_referenz: null, erechnung_email: null } }, { firma: FIRMENDATEN });
  assert.equal(hatFehler(pruefeERechnung(daten, 'en16931')), false);
  assert.equal(hatFehler(pruefeERechnung(daten, 'xrechnung')), true);
});

// ---------------------------------------------------------------- Stammdaten
test('PLZ/Ort-Trennung (gleiche Regeln wie der SQL-Probelauf)', () => {
  const f = (s: string, l = '') => { const v = trennePlzOrt(s, l); return [v.plz, v.ort, v.landCode, v.status]; };
  assert.deepEqual(f('28816 Stuhr'), ['28816', 'Stuhr', 'DE', 'eindeutig']);
  assert.deepEqual(f('D-28195 Bremen', 'Deutschland'), ['28195', 'Bremen', 'DE', 'eindeutig']);
  assert.deepEqual(f('A-1010 Wien', 'Österreich'), [null, null, 'AT', 'manuell']);
  assert.deepEqual(f('1234 AB Amsterdam', 'Niederlande'), [null, null, 'NL', 'manuell']);
  assert.deepEqual(f('Hamburg'), [null, null, 'DE', 'manuell']);
  assert.deepEqual(f('20095 Hamburg', 'Germany?'), ['20095', 'Hamburg', null, 'manuell']);
  assert.deepEqual(f('28195 Bremen Postfach 12'), ['28195', 'Bremen Postfach 12', 'DE', 'manuell']);
  assert.deepEqual(f(''), [null, null, 'DE', 'manuell']);
});

test('Land → ISO-Code', () => {
  assert.equal(landZuIso(''), 'DE');
  assert.equal(landZuIso('Österreich'), 'AT');
  assert.equal(landZuIso('germany'), 'DE');
  assert.equal(landZuIso('Mars'), null);
  assert.equal(normLandCode(' de '), 'DE');
  assert.equal(normLandCode('Deutschland'), null);
});

// ---------------------------------------------------------------- ZUGFeRD
test('sRGB-ICC-Profil: gültiger Kopf (v2.1, Monitor, RGB, D50), Größe stimmt', () => {
  const icc = srgbIccProfil();
  const v = new DataView(icc.buffer);
  const t = (o: number) => new TextDecoder().decode(icc.subarray(o, o + 4));
  assert.equal(v.getUint32(0), icc.length);
  assert.deepEqual([v.getUint32(8), t(12), t(16), t(20), t(36)], [0x02100000, 'mntr', 'RGB ', 'XYZ ', 'acsp']);
  assert.equal(v.getUint32(128), 9, 'neun Tags');
  assert.ok(icc.length < 4000, `klein (${icc.length} Byte)`);
});

test('XMP: PDF/A-3b-Kennung, Factur-X-Erweiterung (EN 16931), Zeiten wie im Info-Eintrag', () => {
  const x = xmpPaket({ titel: 'Rechnung Re_26/1 & <Test>', autor: 'Maja-Logistik M.Janßen', erstellt: new Date('2026-11-10T10:00:00Z') });
  for (const t of ['<pdfaid:part>3</pdfaid:part>', '<pdfaid:conformance>B</pdfaid:conformance>', '<fx:DocumentType>INVOICE</fx:DocumentType>',
    '<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>', '<fx:Version>1.0</fx:Version>', '<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>',
    'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#', '<xmp:CreateDate>2026-11-10T10:00:00Z</xmp:CreateDate>', '<xmp:ModifyDate>2026-11-10T10:00:00Z</xmp:ModifyDate>',
    'Rechnung Re_26/1 &amp; &lt;Test&gt;']) assert.ok(x.includes(t), t);
});

test('ZUGFeRD-PDF: eingebettetes XML = erzeugtes XML, nur eingebettete Schrift, PDF/A-Bausteine vorhanden', async () => {
  const { resolve } = await import('node:path');
  const dateien = await erzeugeZugferdDateien(resolve(process.cwd()));
  assert.equal(dateien.length, 9);
  for (const d of dateien) {
    assert.equal(d.eingebettet, d.xml, `${d.name}: XML unverändert eingebettet`);
    const roh = new TextDecoder('latin1').decode(d.pdf);
    assert.ok(!/\/BaseFont\s*\/Helvetica/.test(roh), `${d.name}: keine Standardschrift`);
    assert.ok(/LiberationSans/.test(roh), `${d.name}: Liberation Sans eingebettet`);
    for (const t of ['/OutputIntents', '/GTS_PDFA1', '/AFRelationship /Alternative', '/AF ', '/Type /Metadata', '/ID [']) assert.ok(roh.includes(t), `${d.name}: ${t}`);
    assert.ok(roh.includes('<pdfaid:part>3</pdfaid:part>'), `${d.name}: XMP unkomprimiert lesbar`);
    assert.ok(!/\/JavaScript|\/AcroForm|\/URI\b/.test(roh), `${d.name}: kein JavaScript/Formular/externer Verweis`);
  }
  const lang = dateien.find((d) => d.name === '16_lange_rechnung')!;
  assert.ok(lang.seiten >= 5, `lange Rechnung mehrseitig (${lang.seiten})`);
  assert.ok(lang.pdf.length < 3_000_000, 'weit unter der Upload-Grenze');
  // Sichtbarer Inhalt: Umlaute, ß, €, Sonderzeichen; Leistungsdatum je Position; Hinweis auf das XML
  const text = await pdfTextVon(dateien.find((d) => d.name === '05_sonderzeichen')!.pdf);
  for (const t of ['Müller & Söhne <Logistik> "Nord" GmbH', 'Königsallee', 'Düsseldorf', '€', 'M.Janßen', 'Leistungsdatum = Tag des Tourabschlusses',
    'E-Rechnung im Format ZUGFeRD', 'Steuernummer: 12/345/67890', 'fällig am:']) assert.ok(text.includes(t), t);
});

test('ZUGFeRD-PDF zeigt denselben Inhalt wie die Lesekopie (nur der Hinweis unterscheidet sich)', async () => {
  const { resolve } = await import('node:path');
  const q = T['12_mehrtaegige_tour'].quelle;
  const { daten } = bildeERechnung(q, { firma: TEST_FIRMA });
  const lesekopie = await pdfText(rechnungPdfInputAus({ rechnung: q.rechnung, positionen: q.positionen, auftraggeber: q.auftraggeber, firma: TEST_FIRMA, ausSnapshot: true, erechnung: daten }));
  const zf = (await erzeugeZugferdDateien(resolve(process.cwd()), false)).find((d) => d.name === '12_mehrtaegige_tour')!;
  const norm = (t: string) => t.replace(/\s+/g, ' ').replace('PDF-Lesekopie. Maßgeblich ist die E-Rechnung (XML nach EN 16931).', '#').replace('E-Rechnung im Format ZUGFeRD. Maßgeblich sind die eingebetteten XML-Daten (EN 16931).', '#').trim();
  assert.equal(norm(await pdfTextVon(zf.pdf)), norm(lesekopie));
});

test('Lieferdatum im Kopf (BT-72): Standard aus; als Option ohne leeres Element', () => {
  const { daten } = bild('12_mehrtaegige_tour');
  assert.equal(LIEFERDATUM_IM_KOPF, 'nie');
  assert.equal(daten.lieferdatum ?? null, null);
  assert.ok(erzeugeCii(daten, 'en16931').includes('<ram:ApplicableHeaderTradeDelivery/>'));
  const mit = erzeugeCii({ ...daten, lieferdatum: daten.leistungBis }, 'en16931');
  assert.ok(/<ram:ApplicableHeaderTradeDelivery>\s*<ram:ActualDeliverySupplyChainEvent>\s*<ram:OccurrenceDateTime>\s*<udt:DateTimeString format="102">20261020</.test(mit));
  assert.equal((mit.match(/ApplicableHeaderTradeDelivery>/g) ?? []).length, 2, 'Element genau einmal (auf/zu)');
});

// ---------------------------------------------------------------- Archiv-Export
function exportEintrag(nr: string, format: 'en16931_cii' | 'zugferd', xmlPfad: string | null): ExportEintrag {
  return {
    dokument: { id: `d-${nr}`, rechnung_id: 'r', gutschrift_id: null, version: 1, format, typ_code: '380', belegnummer: nr,
      xml_pfad: xmlPfad, pdf_pfad: `Maja-Logistik/E-Rechnungen/2026/${nr.replace('/', '_')}.pdf`, bucket_pfad: 'x', protokoll: null,
      sha256_xml: 'a'.repeat(64), sha256_pdf: 'b'.repeat(64), xml_bytes: 1, pdf_bytes: 1, erzeugt_am: '2026-11-05T10:00:00Z', erzeugt_von: null, erzeugt_von_name: null },
    belegnummer: nr, datum: '2026-11-05', empfaenger: 'Müller & Söhne "Nord"; GmbH', auftraggeberId: 'ag', typ: 'Rechnung', brutto: 1234.5, zuletztExportiert: null,
  };
}

test('Export: Monatsgrenzen (auch Februar/Schaltjahr)', () => {
  assert.deepEqual(monatsGrenzen('2026-11'), { von: '2026-11-01', bis: '2026-11-30' });
  assert.deepEqual(monatsGrenzen('2028-02'), { von: '2028-02-01', bis: '2028-02-29' });
  assert.deepEqual(monatsGrenzen('2027-02'), { von: '2027-02-01', bis: '2027-02-28' });
});

test('Export: Dateien je Beleg — XML + Lesekopie bzw. EIN ZUGFeRD-PDF', () => {
  const zwei = dateienVon(exportEintrag('Re_26/5', 'en16931_cii', 'Maja-Logistik/E-Rechnungen/2026/Re_26_5.xml'));
  assert.deepEqual(zwei.map((d) => [d.art, d.name, d.sollHash[0]]), [['XML', '2026/Re_26_5.xml', 'a'], ['PDF-Lesekopie', '2026/Re_26_5.pdf', 'b']]);
  const eins = dateienVon(exportEintrag('Re_26/6', 'zugferd', null));
  assert.deepEqual(eins.map((d) => [d.art, d.name, d.sollHash[0]]), [['ZUGFeRD-PDF', '2026/Re_26_6.pdf', 'b']]);
});

test('Export: ZIP enthält die Dateien Byte für Byte unverändert (Namen in UTF-8)', async () => {
  const dateien = [
    { name: 'Uebersicht.csv', bytes: new TextEncoder().encode('a;b\r\n') },
    { name: '2026/Re_26_5.xml', bytes: new TextEncoder().encode('<x>Müller & Söhne</x>') },
    { name: '2026/Größe_ä.pdf', bytes: new Uint8Array([0, 255, 37, 80, 68, 70, 1, 2, 3]) },
  ];
  const zip = baueZip(dateien, new Date(2026, 10, 5, 10, 0, 0));
  // Zentrales Verzeichnis lesen und jede Datei zurückholen.
  const v = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  assert.equal(v.getUint16(eocd + 10, true), 3);
  let p = v.getUint32(eocd + 16, true);
  for (const f of dateien) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    assert.equal(v.getUint16(p + 10, true), 0, 'ohne Kompression');
    const len = v.getUint32(p + 24, true); const nLen = v.getUint16(p + 28, true); const lokal = v.getUint32(p + 42, true);
    assert.equal(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nLen)), f.name);
    const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
    assert.deepEqual([...zip.subarray(start, start + len)], [...f.bytes]);
    assert.equal(await sha256Hex(zip.subarray(start, start + len)), await sha256Hex(f.bytes));
    p += 46 + nLen;
  }
});

test('Export: CSV mit Escaping, Hash-Prüfung „ok" und deutlicher Abweichung', () => {
  const e = exportEintrag('Re_26/5', 'en16931_cii', 'Maja-Logistik/E-Rechnungen/2026/Re_26_5.xml');
  const [x, y] = dateienVon(e);
  const csv = baueCsv([
    { ...x, eintrag: e, istHash: 'a'.repeat(64), bytes: new Uint8Array(1), fehler: null },
    { ...y, eintrag: e, istHash: 'c'.repeat(64), bytes: new Uint8Array(1), fehler: null },
    { ...y, eintrag: { ...e, empfaenger: '=SUMME(A1)' }, istHash: null, bytes: null, fehler: 'nicht gefunden' },
  ]);
  const zeilen = csv.replace('\uFEFF', '').trim().split('\r\n');
  assert.equal(zeilen[0], '"Belegnummer";"Datum";"Empfänger";"Typ";"Format";"Brutto";"Datei";"Dateiname";"SHA-256";"erzeugt am";"Hash-Prüfung"');
  assert.ok(zeilen[1].startsWith('"Re_26/5";"05.11.2026";"Müller & Söhne ""Nord""; GmbH";"Rechnung";"EN 16931 (XML)";"1234,50";"XML";"2026/Re_26_5.xml";"' + 'a'.repeat(64) + '"'));
  assert.ok(zeilen[1].endsWith(';"ok"'));
  assert.ok(/;"ABWEICHUNG \(Datei: c{64}\)"$/.test(zeilen[2]));
  assert.ok(zeilen[3].includes(`"'=SUMME(A1)"`) && zeilen[3].endsWith(';"FEHLER: nicht gefunden"'));
  assert.ok(csv.startsWith('\uFEFF'));
});

// ---------------------------------------------------------------- Lauf
let ok = 0; const fehler: string[] = [];
for (const f of faelle) {
  try { await f.fn(); ok += 1; console.log(`  ok    ${f.name}`); } catch (e) {
    fehler.push(f.name); console.log(`  FAIL  ${f.name}\n        ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`Unit-Tests: ${ok}/${faelle.length} bestanden`);
if (fehler.length) process.exitCode = 1;
