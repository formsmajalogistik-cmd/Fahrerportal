import { erechnungUmgebung, pruefer } from './erechnung-umgebung.mjs';
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const MOBIL = process.argv[4] === 'mobil';
const { pr, ende } = pruefer();
const { b, pg, B, s, AG, rechnungen, positionen, gpositionen, log } = await erechnungUmgebung({ OUT, THEME, MOBIL });

// ---- A) Firmendaten
await pg.goto(`${B}/einstellungen/firmendaten`);
await pg.locator('#fd-name').waitFor({ timeout: 15000 });
pr('Firmendaten: Werte aus den Einstellungen geladen', (await pg.locator('#fd-steuernummer').inputValue()) === '12/345/67890' && (await pg.locator('#standard-zahlungsziel').inputValue()) === '14');
await s('firmendaten');
if (!MOBIL) {
  await pg.locator('#fd-registergericht').fill('Amtsgericht Walsrode');
  await pg.locator('#fd-registernummer').fill('HRA 999');
  await pg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await pg.getByText('Gespeichert. Gilt für künftig erstellte').waitFor({ timeout: 5000 });
  const up = log.settingsUp.find((x) => x.key === 'firmendaten');
  pr('Firmendaten gespeichert (snake_case, Register)', up?.value?.registergericht === 'Amtsgericht Walsrode' && up?.value?.registernummer === 'HRA 999' && up?.value?.kontakt_name === 'Test Kontakt', up);
  pr('Standard-Zahlungsziel unverändert (nicht mitgespeichert)', !log.settingsUp.some((x) => x.key === 'rechnung_einstellungen'));
}

// ---- B) XRechnung ohne Käuferreferenz → blockiert
await pg.goto(`${B}/rechnungen/r2`);
await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 15000 });
const txtB = await pg.getByTestId('erechnung-abschnitt').innerText();
pr('Entwurf XRechnung: Vorprüfung zeigt „Käuferreferenz fehlt (Pflicht bei XRechnung)"', txtB.includes('Käuferreferenz fehlt (Pflicht bei XRechnung)') && txtB.includes('XRechnung'), txtB);
await s('entwurf_xrechnung_blockiert');
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung: Pflichtangaben fehlen').waitFor({ timeout: 8000 });
pr('Erstellen blockiert: kein Statuswechsel, kein Archiv', !log.patchR.some((x) => x.id === 'r2') && log.archiv.length === 0 && rechnungen.r2.status === 'entwurf', log.patchR);

// ---- B2) Käuferreferenz nachgetragen → XRechnung wird erzeugt
AG.ag2.kaeufer_referenz = 'LW-4711-99';
await pg.goto(B + '/rechnungen/r2');
await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 15000 });
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 8000 });
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 20000 });
const xr = Buffer.from(log.archiv.find((x) => x.id === 'r2').xml_base64, 'base64').toString();
pr('XRechnung nach Nachtragen: erzeugt mit BT-10 und E-Rechnungs-Adresse', xr.includes('xrechnung_3.0') && xr.includes('<ram:BuyerReference>LW-4711-99</ram:BuyerReference>') && xr.includes('eingang@xr.example'));

// ---- C) EN 16931 ohne Referenz/E-Rechnungs-Adresse → erstellt + archiviert
await pg.goto(`${B}/rechnungen/r1`);
await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 15000 });
pr('Entwurf EN 16931: keine Fehler in der Vorprüfung', (await pg.getByTestId('erechnung-abschnitt').innerText()).includes('Alle Pflichtangaben vorhanden'));
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 20000 });
const a1 = log.archiv.find((x) => x.id === 'r1');
const xml1 = a1 ? Buffer.from(a1.xml_base64, 'base64').toString() : '';
pr('Status offen, Archiv-Aufruf mit XML (EN 16931, Typ 380)', rechnungen.r1.status === 'offen' && xml1.includes('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>') && xml1.includes('<ram:TypeCode>380</ram:TypeCode>'));
pr('XML: Leistungsdatum je Position (mehrtägig → Abschlusstag 15.10.)', /<ram:LineID>1<\/ram:LineID>[\s\S]*?20261015/.test(xml1) && xml1.includes('20261020'));
pr('XML: Snapshot-Firmendaten (Steuernummer, Kontakt), BG-9 Sachbearbeiter', xml1.includes('schemeID="FC">12/345/67890') && xml1.includes('<ram:PersonName>Test Kontakt</ram:PersonName>') && xml1.includes('<ram:PersonName>Frau Kundin</ram:PersonName>'));
pr('XML: Fälligkeit aus dem gespeicherten Wert (05.11. + 14)', xml1.includes('20261119'));
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 5000 });
pr('Sperre sichtbar: Stammdaten/Positionen/Löschen deaktiviert',
  await pg.getByRole('button', { name: 'Stammdaten bearbeiten' }).isDisabled()
  && await pg.getByRole('button', { name: 'Bearbeiten', exact: true }).isDisabled()
  && await pg.getByRole('button', { name: 'Rechnung löschen' }).isDisabled());
pr('E-Rechnungs-Abschnitt zeigt Archiv (Format, Typ, SHA-256)', (await pg.getByTestId('erechnung-abschnitt').innerText()).includes('SHA-256 (XML)'));
await s('rechnung_erechnung_erstellt');

// ---- D) Versand: Probeversand + echter Versand
await pg.getByRole('button', { name: 'E-Rechnung per E-Mail versenden' }).first().click();
await pg.getByTestId('erechnung-anhaenge').waitFor({ timeout: 5000 });
const body1 = await pg.locator('#re-body').inputValue();
pr('Mailtext enthält den E-Rechnungs-Hinweis', body1.includes('Die maßgebliche Rechnung ist die angehängte XML-Datei'));
await pg.locator('form').getByText('rechnung@en-kunde.example').first().waitFor({ timeout: 5000 }).catch(() => {});
const anVorgabe = await pg.locator('form').innerText();
pr('Empfänger ohne E-Rechnungs-Adresse: Rechnungs-E-Mail des Auftraggebers', anVorgabe.includes('rechnung@en-kunde.example'), anVorgabe.slice(0, 300));
await s('versand_dialog');
await pg.getByRole('button', { name: 'Probeversand an mich' }).click();
await pg.getByText(/Probeversand an buchhaltung@maja-logistik.de gesendet/).waitFor({ timeout: 8000 });
const probe = log.mails.at(-1);
pr('Probeversand: an Kontakt-E-Mail, XML + PDF, KEIN Versandstatus', probe.to[0] === 'buchhaltung@maja-logistik.de' && !probe.versand_beleg && probe.attachments.map((x) => x.contentType).join() === 'application/xml,application/pdf' && probe.subject.startsWith('[Probeversand]'), probe);
pr('Probeversand setzt email_versendet_am nicht', !log.patchR.some((x) => x.id === 'r1' && 'email_versendet_am' in x));
await pg.getByRole('button', { name: 'Senden', exact: true }).click();
await pg.waitForTimeout(800);
const echt = log.mails.at(-1);
pr('Versand: XML + PDF-Lesekopie, Versandprotokoll, an Auftraggeber-Rechnungs-E-Mail', echt.versand_beleg?.id === 'r1' && echt.attachments[0].name === 'Re_26_2001.xml' && echt.attachments[1].onedrive_path.endsWith('.pdf') && echt.to.includes('rechnung@en-kunde.example'), echt);

// ---- E) Storno → 381
await pg.goto(`${B}/rechnungen/r1`);
await pg.getByRole('button', { name: 'Stornieren' }).click();
await pg.getByRole('button', { name: 'Stornieren' }).last().click();
await pg.waitForURL(/\/gutschriften\/g1/, { timeout: 20000 });
await pg.getByText('Stornorechnung angelegt').waitFor({ timeout: 8000 });
const a2 = log.archiv.find((x) => x.beleg === 'gutschrift');
const xml2 = a2 ? Buffer.from(a2.xml_base64, 'base64').toString() : '';
pr('Storno: RPC + E-Rechnung Typ 381 mit Bezug auf Re_26/2001', log.rpc[0] === 'r1' && xml2.includes('<ram:TypeCode>381</ram:TypeCode>') && /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>Re_26\/2001/.test(xml2));
pr('Original storniert', rechnungen.r1.status === 'storniert');
await pg.getByTestId('erechnung-abschnitt').waitFor({ timeout: 8000 });
pr('Stornorechnung: endgültig (Löschen gesperrt), E-Rechnung archiviert', await pg.getByRole('button', { name: /löschen/ }).isDisabled());
await s('stornorechnung');
await pg.goto(`${B}/rechnungen/r1`);
await pg.getByTestId('storniert-hinweis').waitFor({ timeout: 10000 });
await pg.getByRole('button', { name: 'Als neue Rechnung übernehmen' }).click();
await pg.waitForURL(/\/rechnungen\/r4/, { timeout: 10000 });
pr('Als neue Rechnung übernehmen → neuer Entwurf mit Positionen', rechnungen.r4?.status === 'entwurf' && positionen.filter((x) => x.rechnung_id === 'r4').length === 3);

// ---- F) PDF-Rechnung: PDF neu generieren behält alte Version
await pg.goto(`${B}/rechnungen/r3`);
await pg.getByRole('button', { name: 'PDF neu generieren' }).waitFor({ timeout: 15000 });
pr('PDF-Rechnung: keine Sperre, kein E-Rechnungs-Abschnitt', (await pg.getByTestId('sperr-hinweis').count()) === 0 && (await pg.getByTestId('erechnung-abschnitt').count()) === 0);
await pg.getByRole('button', { name: 'PDF neu generieren' }).click();
await pg.getByText('bleibt als „Re_26_2003_v1.pdf" erhalten').waitFor({ timeout: 15000 });
pr('PDF neu generieren: Upload mit versionieren', log.upload.at(-1)?.versionieren === true && log.upload.at(-1)?.path === 'Maja-Logistik/Rechnungen/2026/Re_26_2003.pdf', log.upload);

// ---- G) Teilgutschrift
await pg.getByRole('button', { name: 'Teilgutschrift' }).click();
await pg.getByRole('dialog').waitFor();
await pg.getByLabel('Position 2 auswählen').check();
const preis = pg.getByRole('dialog').locator('li').nth(1).getByLabel('Einzelpreis (€)');
await preis.fill('50,00');
await pg.getByRole('button', { name: 'Teilgutschrift als Entwurf anlegen' }).click();
await pg.getByText('höher als der Rechnungsbetrag').waitFor({ timeout: 5000 });
pr('Teilgutschrift: Betrag über Positionsbetrag abgelehnt', log.gsInsert.length === 0);
await preis.fill('15,00');
await s('teilgutschrift_dialog');
await pg.getByRole('button', { name: 'Teilgutschrift als Entwurf anlegen' }).click();
await pg.waitForURL(/\/gutschriften\/g2/, { timeout: 10000 });
const gi = log.gsInsert[0];
pr('Teilgutschrift-Entwurf: Art, Bezug, Betrag positiv', gi.art === 'teilgutschrift' && gi.bezug_rechnungsnummer === 'Re_26/2003' && gi.status === 'entwurf' && gi.netto_summe === 15 && gpositionen.some((x) => x.gutschrift_id === 'g2' && x.einzelpreis === 15), gi);

await ende(b);
