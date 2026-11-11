// ZUGFeRD im echten App-Ablauf: Entwurf → „Rechnung erstellen" → Archiv
// (EINE Datei) → Versand (ein Anhang) → Storno (381, ebenfalls ZUGFeRD).
// Die an den Server gesendeten Dateien landen in <Ausgabe>/xml/ und werden
// anschließend mit „npm run erechnung:pruefe-zugferd" validiert.
//
// Aufruf: … <Ausgabeordner> [light|dark] [mobil]
//   mobil = Handy-Bildschirm + 4-fach gedrosselte CPU (grobe Laufzeitmessung)
import { writeFileSync } from 'node:fs';
import { erechnungUmgebung, pruefer } from './erechnung-umgebung.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const MOBIL = process.argv[4] === 'mobil';
const { pr, ende } = pruefer();
const { b, ctx, pg, B, s, AG, rechnungen, positionen, gutschriften, log, basisR, P } = await erechnungUmgebung({ OUT, THEME, MOBIL });

// Empfänger mit Format ZUGFeRD (in der Datenbank gesetzt — unabhängig davon,
// ob das Format in der Auswahl schon freigeschaltet ist).
AG.ag4 = { ...AG.ag1, id: 'ag4', name: 'ZUGFeRD-Kunde Müller & Söhne GmbH', strasse: 'Straße der Größe 7', plz: '28195', ort: 'Bremen',
  email1: 'rechnung@zf-kunde.example', kundennummer: 'K-4', kunden_uid: 'DE444444444', erechnung_format: 'zugferd', erechnung_email: 'eingang@zf-kunde.example', kaeufer_referenz: 'BEST-2026-77' };
rechnungen.rz = basisR('rz', 'Re_26/2010', 'ag4', 'entwurf', ['28195', 'Bremen']);
positionen.push(
  P('pz1', 'rz', 1, 'Überführung Bremen nach München 13.10./15.10.26', 480, 'tz1', '2026-10-15'),
  P('pz2', 'rz', 2, 'Überführung Bremen nach Hamburg 20.10.26', 150, 'tz2', '2026-10-20'),
  P('pz3', 'rz', 3, 'Wartezeit (2 × 30 Min.) — „Sonderfall" ß/€', 20, null, null),
);

if (MOBIL) {
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

// ---- A) Entwurf: Vorprüfung
await pg.goto(`${B}/rechnungen/rz`);
await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 30000 });
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 15000 });
const txtA = await pg.getByTestId('erechnung-abschnitt').innerText();
pr('Entwurf: Vorprüfung nennt ZUGFeRD und EINE Datei', txtA.includes('ZUGFeRD (PDF mit eingebettetem XML)') && txtA.includes('wird das ZUGFeRD-PDF (mit eingebettetem XML) erzeugt'), txtA);
await s('zugferd_entwurf');

// ---- B) Erstellen → Archiv-Aufruf abfangen
let ankunft = 0;
pg.on('request', (rq) => { if (rq.url().includes('action=erechnung-archivieren') && !ankunft) ankunft = Date.now(); });
const start = Date.now();
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 120000 });
const fertig = Date.now();
const a1 = log.archiv.find((x) => x.id === 'rz');
const pdf1 = Buffer.from(a1?.pdf_base64 ?? '', 'base64');
const t1 = pdf1.toString('latin1');
pr('Archiv-Aufruf: EINE Datei (kein separates XML)', !!a1 && a1.xml_base64 === undefined && pdf1.length > 10000, a1 ? Object.keys(a1) : null);
pr('Datei ist PDF/A-3 mit Anhang factur-x.xml (AFRelationship Alternative)', t1.startsWith('%PDF-') && t1.includes('<pdfaid:part>3</pdfaid:part>') && t1.includes('<pdfaid:conformance>B</pdfaid:conformance>')
  && t1.includes('factur-x.xml') && t1.includes('/AFRelationship /Alternative') && t1.includes('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>'));
pr('Eingebettete Schrift (Liberation Sans), keine Standardschrift Helvetica', /LiberationSans/.test(t1) && !/\/BaseFont \/Helvetica/.test(t1));
pr('Status offen, Format an der Rechnung festgehalten', rechnungen.rz.status === 'offen' && rechnungen.rz.erechnung_format === 'zugferd');
pr('Body bleibt weit unter der Grenze (~4,5 MB)', (a1?.pdf_base64.length ?? 9e9) < 2_000_000, a1?.pdf_base64.length);
const messung = { geraet: MOBIL ? 'Handy-Emulation (390×844, CPU 4-fach gedrosselt)' : 'Desktop', pdf_kb: Math.round(pdf1.length / 1024), body_kb: Math.round((a1?.pdf_base64.length ?? 0) / 1024),
  klick_bis_upload_ms: ankunft - start, klick_bis_fertig_ms: fertig - start };
writeFileSync(`${OUT}/messung.json`, JSON.stringify(messung, null, 2));
console.log(`  info  Messung: ${JSON.stringify(messung)}`);

// ---- C) Anzeige + Sperre
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 10000 });
const txtC = await pg.getByTestId('erechnung-abschnitt').innerText();
pr('Abschnitt: ZUGFeRD-PDF maßgeblich, SHA-256 der PDF-Datei, kein XML-Knopf', txtC.includes('ZUGFeRD-PDF herunterladen (maßgeblich)') && txtC.includes('SHA-256 (PDF)') && !txtC.includes('XML herunterladen'), txtC);
pr('Sperre wie bei den anderen E-Rechnungs-Formaten', await pg.getByRole('button', { name: 'Stammdaten bearbeiten' }).isDisabled() && await pg.getByRole('button', { name: 'Rechnung löschen' }).isDisabled());
await s('zugferd_erstellt');

// ---- D) Versand: Probeversand + echter Versand
await pg.getByRole('button', { name: 'E-Rechnung per E-Mail versenden' }).first().click();
await pg.getByTestId('erechnung-anhaenge').waitFor({ timeout: 10000 });
const mailText = await pg.locator('#re-body').inputValue();
pr('Mailtext: ZUGFeRD-Hinweis (wortgleich), kein XML-Hinweis',
  mailText.includes('Diese Rechnung ist eine E-Rechnung im Format ZUGFeRD. Das PDF enthält die maschinenlesbaren Rechnungsdaten (XML); maßgeblich sind die eingebetteten XML-Daten.')
  && !mailText.includes('angehängte XML-Datei'), mailText);
const anh = await pg.getByTestId('erechnung-anhaenge').innerText();
pr('Anhänge im Dialog: genau das ZUGFeRD-PDF', anh.includes('Re_26_2010.pdf') && !anh.includes('.xml'), anh);
await s('zugferd_versand');
await pg.getByRole('button', { name: 'Probeversand an mich' }).click();
await pg.getByText(/Probeversand an buchhaltung@maja-logistik.de gesendet/).waitFor({ timeout: 10000 });
const probe = log.mails.at(-1);
pr('Probeversand: an die eigene Adresse, EIN PDF-Anhang, kein Versandstatus', probe.to[0] === 'buchhaltung@maja-logistik.de' && probe.to.length === 1 && !probe.versand_beleg
  && probe.attachments.length === 1 && probe.attachments[0].onedrive_path === 'Maja-Logistik/E-Rechnungen/2026/Re_26_2010.pdf' && probe.subject.startsWith('[Probeversand]'), probe);
await pg.getByRole('button', { name: 'Senden', exact: true }).click();
await pg.waitForTimeout(1000);
const echt = log.mails.at(-1);
pr('Versand: an die E-Rechnungs-Adresse, EIN Anhang (ZUGFeRD-PDF aus dem Archiv), protokolliert', echt.versand_beleg?.id === 'rz' && echt.to.includes('eingang@zf-kunde.example')
  && echt.attachments.length === 1 && echt.attachments[0].onedrive_path === 'Maja-Logistik/E-Rechnungen/2026/Re_26_2010.pdf', echt);

if (!MOBIL) {
  // ---- E) Storno → Stornorechnung als ZUGFeRD (Typ 381)
  await pg.goto(`${B}/rechnungen/rz`);
  await pg.getByRole('button', { name: 'Stornieren' }).click();
  await pg.getByRole('button', { name: 'Stornieren' }).last().click();
  await pg.waitForURL(/\/gutschriften\/g1/, { timeout: 60000 });
  await pg.getByText('Stornorechnung angelegt').waitFor({ timeout: 20000 });
  const a2 = log.archiv.find((x) => x.beleg === 'gutschrift');
  const t2 = Buffer.from(a2?.pdf_base64 ?? '', 'base64').toString('latin1');
  pr('Storno: Stornorechnung ebenfalls als EINE ZUGFeRD-Datei', !!a2 && a2.xml_base64 === undefined && t2.includes('factur-x.xml') && gutschriften.g1.erechnung_format === 'zugferd');
  pr('Original storniert', rechnungen.rz.status === 'storniert');
  await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 10000 });
  pr('Stornorechnung: Abschnitt zeigt ZUGFeRD-PDF, Typ 381', /Typ 381/.test(await pg.getByTestId('erechnung-abschnitt').innerText()), await pg.getByTestId('erechnung-abschnitt').innerText());
  await s('zugferd_storno');
}

await ende(b);
