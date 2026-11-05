// Unit-Tests E-Rechnung (ohne Validator). Ausführen: npm run test:erechnung
import assert from 'node:assert/strict';
import { bildeERechnung } from '../../src/lib/erechnung/ausRechnung';
import { erzeugeCii, betrag, menge } from '../../src/lib/erechnung/cii';
import { pruefeERechnung, hatFehler } from '../../src/lib/erechnung/pruefung';
import { escapeAttr, escapeText } from '../../src/lib/erechnung/xml';
import { landZuIso, normLandCode, trennePlzOrt } from '../../src/lib/erechnung/stammdaten';
import { ERechnungAbbruch } from '../../src/lib/erechnung/typen';
import { testDateiname } from '../../src/lib/erechnung';
import { berechneSummenProUst } from '../../src/lib/rechnungsformat';
import { generateRechnungPdf } from '../../src/pages/admin/rechnungen/rechnungPdf';
import { FIRMENDATEN } from '../../src/lib/firmendaten';
import { TEST_FIRMA, testrechnungen } from './testrechnungen';

type Fall = { name: string; fn: () => void | Promise<void> };
const faelle: Fall[] = [];
const test = (name: string, fn: Fall['fn']) => faelle.push({ name, fn });

const T = Object.fromEntries(testrechnungen().map((t) => [t.name, t]));
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
test('Abbruch: Gutschrift/Korrektur (Typ ≠ 380)', () => {
  const { daten } = bild('01_ab_tour');
  assert.throws(() => erzeugeCii({ ...daten, typ: '381' as '380' }), ERechnungAbbruch);
  assert.throws(() => erzeugeCii({ ...daten, typ: '384' as '380' }), /nur Rechnungen \(380\)/);
});

test('Abbruch: Auslagenrechnung', () => {
  const t = T['01_ab_tour'];
  const r = bildeERechnung({ ...t.quelle, rechnung: { ...t.quelle.rechnung, ist_auslagen_rechnung: true } }, { firma: TEST_FIRMA });
  assert.match(r.abbruch ?? '', /Auslagenrechnung/);
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

test('PDF und XML zeigen dieselben Beträge (Textvergleich des PDFs)', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createRequire } = await import('node:module');
  const { dirname } = await import('node:path');
  const schriften = `${dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))}/standard_fonts/`;
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false });
  const eur = (n: number) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
  for (const name of ['01_ab_tour', '02_aba_tour', '03_zwei_steuersaetze', '04_manuell_zahlungsziel']) {
    const q = T[name].quelle;
    const { daten } = bildeERechnung(q, { firma: TEST_FIRMA });
    const blob = await generateRechnungPdf({
      rechnungsnummer: q.rechnung.rechnungsnummer, datum: q.rechnung.datum, anrede: q.rechnung.anrede,
      kundennummer: q.rechnung.kundennummer, sachbearbeiter: q.rechnung.sachbearbeiter, faelligAm: daten.faelligAm,
      empfaenger: { firma: q.rechnung.rechnungsadresse_firma, ansprechpartner: q.rechnung.ansprechpartner, strasse: q.rechnung.rechnungsadresse_strasse, plz_ort: q.rechnung.rechnungsadresse_plz_ort, land: q.rechnung.rechnungsadresse_land },
      kundenUid: null, zahlungszielTage: daten.zahlungszielTage, ustSatzDefault: Number(q.rechnung.ust_satz),
      positionen: q.positionen.map((p, i) => ({ position_nr: i + 1, bezeichnung: p.bezeichnung, unterzeilen: p.unterzeilen, menge: p.menge, einzelpreis: p.einzelpreis, gesamtpreis: p.gesamtpreis, ust_satz: p.ust_satz })),
    });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false, standardFontDataUrl: schriften }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i += 1) {
      const c = await (await doc.getPage(i)).getTextContent();
      text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
    }
    const xml = erzeugeCii(daten);
    const soll = [daten.summen.netto, daten.summen.brutto, ...daten.summen.gruppen.map((g) => g.ust), ...daten.positionen.map((p) => p.netto)];
    for (const n of soll) {
      assert.ok(text.includes(eur(n)), `${name}: PDF enthält ${eur(n)}`);
      assert.ok(xml.includes(`>${betrag(n)}<`), `${name}: XML enthält ${betrag(n)}`);
    }
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

test('Kleinbetrag ≤ 250 € → Hinweis', () => {
  const { daten } = bild('01_ab_tour'); // 192 + 19 % = 228,48
  assert.ok(pruefeERechnung(daten).some((x) => x.schwere === 'hinweis' && /Kleinbetrag/.test(x.text)));
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

// ---------------------------------------------------------------- Lauf
let ok = 0; const fehler: string[] = [];
for (const f of faelle) {
  try { await f.fn(); ok += 1; console.log(`  ok    ${f.name}`); } catch (e) {
    fehler.push(f.name); console.log(`  FAIL  ${f.name}\n        ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`Unit-Tests: ${ok}/${faelle.length} bestanden`);
if (fehler.length) process.exitCode = 1;
