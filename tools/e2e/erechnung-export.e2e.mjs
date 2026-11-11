// Archiv-Export (Einstellungen → „E-Rechnungen exportieren", nur Admin):
// Zeitraum/Empfänger-Filter, ZIP mit unveränderten Originaldateien + CSV,
// Hash-Prüfung vor dem Packen, „zuletzt exportiert", Direkt-Links von
// OneDrive mit Ersatzweg — und: der Export löscht/ändert nichts.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pw, START, BASIS } from './basis.mjs';
import { UID, pruefer } from './erechnung-umgebung.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light';
const { pr, ende } = pruefer();
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- Archiv (Stub)
const W = 'Maja-Logistik/E-Rechnungen/2026';
const dateien = {
  [`${W}/Re_26_3001.xml`]: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice>Re_26/3001 — Müller & Söhne</rsm:CrossIndustryInvoice>'),
  [`${W}/Re_26_3001.pdf`]: Buffer.from('%PDF-1.7 Lesekopie Re_26/3001\n%%EOF'),
  [`${W}/Re_26_3002.pdf`]: Buffer.from('%PDF-1.7 ZUGFeRD Re_26/3002 mit factur-x.xml\n%%EOF'),
  [`${W}/GS_2026_9.xml`]: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice>GS-2026/9</rsm:CrossIndustryInvoice>'),
  [`${W}/GS_2026_9.pdf`]: Buffer.from('%PDF-1.7 Lesekopie GS-2026/9\n%%EOF'),
  [`${W}/Re_26_2950.xml`]: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice>Re_26/2950</rsm:CrossIndustryInvoice>'),
  [`${W}/Re_26_2950.pdf`]: Buffer.from('%PDF-1.7 Lesekopie Re_26/2950\n%%EOF'),
};
const original = Object.fromEntries(Object.entries(dateien).map(([k, v]) => [k, Buffer.from(v)]));
const dok = (id, nr, format, typ, xml, pdf, beleg) => ({
  id, rechnung_id: beleg.rechnung ? `r-${id}` : null, gutschrift_id: beleg.gutschrift ? `g-${id}` : null, version: 1, format, typ_code: typ, belegnummer: nr,
  xml_pfad: xml ? `${W}/${xml}` : null, pdf_pfad: `${W}/${pdf}`, bucket_pfad: `2026/${xml ?? pdf}`,
  sha256_xml: xml ? sha(original[`${W}/${xml}`]) : null, sha256_pdf: sha(original[`${W}/${pdf}`]), xml_bytes: 1, pdf_bytes: 1,
  erzeugt_am: '2026-10-21T08:30:00Z', erzeugt_von: UID, erzeugt_von_name: 'Ad Min', protokoll: null,
  rechnung: beleg.rechnung ?? null, gutschrift: beleg.gutschrift ?? null,
});
const dokumente = [
  dok('d1', 'Re_26/3001', 'en16931_cii', '380', 'Re_26_3001.xml', 'Re_26_3001.pdf', { rechnung: { datum: '2026-10-20', rechnungsadresse_firma: 'Müller & Söhne GmbH', ansprechpartner: null, brutto_summe: 773.5, auftraggeber_id: 'ag1' } }),
  dok('d2', 'Re_26/3002', 'zugferd', '380', null, 'Re_26_3002.pdf', { rechnung: { datum: '2026-10-21', rechnungsadresse_firma: 'ZUGFeRD-Kunde KG', ansprechpartner: null, brutto_summe: 119, auftraggeber_id: 'ag4' } }),
  dok('d3', 'GS-2026/9', 'en16931_cii', '381', 'GS_2026_9.xml', 'GS_2026_9.pdf', { gutschrift: { datum: '2026-10-22', adress_snapshot: { firma: 'Müller & Söhne GmbH' }, brutto_summe: 773.5, art: 'storno', auftraggeber_id: 'ag1' } }),
  dok('d4', 'Re_26/2950', 'en16931_cii', '380', 'Re_26_2950.xml', 'Re_26_2950.pdf', { rechnung: { datum: '2026-09-30', rechnungsadresse_firma: 'Müller & Söhne GmbH', ansprechpartner: null, brutto_summe: 59.5, auftraggeber_id: 'ag1' } }),
];
const exporte = [];
const log = { schreibend: [], onedrive: [], direkt: [], ersatz: [], urlAnfragen: [] };
// Für diese Datei liefert der Server keinen Direkt-Link → Ersatzweg über die Download-Route.
const OHNE_DIREKT = `${W}/GS_2026_9.pdf`;

const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
  access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url()); const m = req.method();
  const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const body = () => { try { return JSON.parse(req.postData() ?? 'null'); } catch { return null; } };
  // „OneDrive"-Direkt-Links (kurzlebig, ohne Anmeldung, mit CORS-Freigabe)
  if (u.hostname === 'onedrive-direkt.example') {
    const pfad = decodeURIComponent(u.pathname.slice(1)); log.direkt.push(pfad);
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' }, body: dateien[pfad] });
  }
  if (u.pathname.startsWith('/api/onedrive')) {
    const a = u.searchParams.get('action'); log.onedrive.push(a);
    if (a === 'archiv-urls') {
      const { paths } = body(); log.urlAnfragen.push(paths);
      return json({ urls: Object.fromEntries(paths.map((p) => [p, p === OHNE_DIREKT ? null : `https://onedrive-direkt.example/${encodeURIComponent(p)}`])) });
    }
    if (a === 'download') { const pfad = u.searchParams.get('path'); log.ersatz.push(pfad); return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: dateien[pfad] }); }
    return json({ error: 'im Export nicht erwartet' }, 500);
  }
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const p = u.pathname;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) log.schreibend.push({ m, p, body: body() });
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/auftraggeber') return json([{ id: 'ag1', name: 'Müller & Söhne GmbH' }, { id: 'ag4', name: 'ZUGFeRD-Kunde KG' }]);
  if (p === '/rest/v1/rechnungen') return json([]);
  if (p === '/rest/v1/erechnung_dokumente') return json(dokumente);
  if (p === '/rest/v1/erechnung_exporte') {
    if (m === 'POST') { for (const z of body()) exporte.push({ ...z, exportiert_am: new Date().toISOString() }); return json([], 201); }
    return json(exporte.map((e) => ({ dokument_id: e.dokument_id, exportiert_am: e.exportiert_am })));
  }
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('pageerror', e.message));

/** Einträge einer ZIP-Datei ohne Kompression („stored") lesen. */
function leseZip(buf) {
  const out = {};
  let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const methode = buf.readUInt16LE(o + 8); const groesse = buf.readUInt32LE(o + 18);
    const n = buf.readUInt16LE(o + 26); const x = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + n).toString('utf8');
    out[name] = { methode, bytes: buf.subarray(o + 30 + n + x, o + 30 + n + x + groesse) };
    o += 30 + n + x + groesse;
  }
  return out;
}
const kopf = () => pg.locator('section h3').filter({ hasText: /Beleg/ }).innerText();
const exportieren = async () => {
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.getByRole('button', { name: 'ZIP herunterladen' }).click()]);
  await pg.getByTestId('export-ergebnis').waitFor({ timeout: 20000 });
  const buf = readFileSync(await dl.path());
  return { name: dl.suggestedFilename(), buf, zip: leseZip(buf) };
};

// ---- A) Liste für den Monat, Filter Empfänger
await pg.goto(`${BASIS}/einstellungen/erechnung-export`);
await pg.locator('#exp-monat').waitFor({ timeout: 30000 });
await pg.locator('#exp-monat').fill('2026-10');
await pg.getByText('Re_26/3001').waitFor({ timeout: 15000 });
pr('Monat 10/2026: 3 Belege · 5 Dateien (Rechnung, ZUGFeRD, Storno) — September-Beleg nicht dabei', (await kopf()) === '3 Belege · 5 Dateien' && (await pg.getByText('Re_26/2950').count()) === 0, await kopf());
const zeilen = await pg.locator('tbody tr').allInnerTexts();
pr('Zeilen: Typ, Format, Brutto, „noch nie" exportiert', zeilen[0].includes('Rechnung') && zeilen[0].includes('773,50') && zeilen[1].includes('ZUGFeRD') && zeilen[2].includes('Storno') && zeilen.every((z) => z.includes('noch nie')), zeilen);
await pg.locator('#exp-ag').selectOption('ag4');
await pg.getByText('1 Beleg · 1 Datei').waitFor({ timeout: 8000 });
pr('Filter Empfänger: nur der ZUGFeRD-Beleg (eine Datei)', (await pg.locator('tbody tr').count()) === 1 && (await pg.locator('tbody tr').innerText()).includes('Re_26/3002'));
await pg.locator('#exp-ag').selectOption('');
await pg.getByText('3 Belege · 5 Dateien').waitFor({ timeout: 8000 });
await pg.screenshot({ path: `${OUT}/export_liste_${THEME}.png`, fullPage: true });

// ---- B) Export: ZIP + CSV, Hash-Prüfung, Direkt-Links
const e1 = await exportieren();
writeFileSync(`${OUT}/${e1.name}`, e1.buf);
pr('Dateiname E-Rechnungen_2026-10.zip', e1.name === 'E-Rechnungen_2026-10.zip', e1.name);
const erwartet = ['2026/GS_2026_9.pdf', '2026/GS_2026_9.xml', '2026/Re_26_3001.pdf', '2026/Re_26_3001.xml', '2026/Re_26_3002.pdf', 'Uebersicht.csv'];
pr('ZIP enthält Uebersicht.csv + 5 Originaldateien (ZUGFeRD als EINE Datei)', JSON.stringify(Object.keys(e1.zip).sort()) === JSON.stringify(erwartet), Object.keys(e1.zip).sort());
pr('Originaldateien unverändert (Byte für Byte, unkomprimiert abgelegt)', erwartet.slice(0, 5).every((n) => e1.zip[n]?.methode === 0 && sha(e1.zip[n].bytes) === sha(original[`Maja-Logistik/E-Rechnungen/${n}`])));
const csv = e1.zip['Uebersicht.csv'].bytes.toString('utf8');
const csvZeilen = csv.replace(/^﻿/, '').trim().split('\r\n');
pr('CSV: Kopfzeile mit Belegnummer, Datum, Empfänger, Typ, Format, Brutto, Dateiname, SHA-256, erzeugt am',
  csv.charCodeAt(0) === 0xFEFF && ['Belegnummer', 'Datum', 'Empfänger', 'Typ', 'Format', 'Brutto', 'Dateiname', 'SHA-256', 'erzeugt am'].every((k) => csvZeilen[0].includes(`"${k}"`)), csvZeilen[0]);
pr('CSV: eine Zeile je Datei mit Hash und „ok"', csvZeilen.length === 6 && csvZeilen.slice(1).every((z) => z.endsWith('"ok"'))
  && csvZeilen.some((z) => z.includes('"Re_26/3002"') && z.includes('"ZUGFeRD (PDF)"') && z.includes('"119,00"') && z.includes(sha(original[`${W}/Re_26_3002.pdf`])))
  && csvZeilen.some((z) => z.includes('"GS-2026/9"') && z.includes('"Storno"') && z.includes('"22.10.2026"') && z.includes('"Müller & Söhne GmbH"')), csvZeilen);
pr('Meldung: 5 Dateien exportiert — alle Hash-Prüfungen bestanden', (await pg.getByTestId('export-ergebnis').innerText()).includes('5 Dateien exportiert — alle Hash-Prüfungen bestanden'));
pr('Download direkt über kurzlebige Links (4 Dateien), Ersatzweg nur für die Datei ohne Link', log.direkt.length === 4 && log.ersatz.length === 1 && log.ersatz[0] === OHNE_DIREKT && log.urlAnfragen.length === 1 && log.urlAnfragen[0].length === 5,
  { direkt: log.direkt.length, ersatz: log.ersatz });
pr('Export-Protokoll: je Beleg ein Eintrag mit hash_ok', exporte.length === 3 && exporte.every((x) => x.hash_ok === true && x.exportiert_von_name === 'Ad Min' && x.hinweis === null), exporte);
pr('Export löscht/ändert nichts (einziger Schreibzugriff: Export-Protokoll; OneDrive nur lesend)',
  log.schreibend.every((x) => x.m === 'POST' && x.p === '/rest/v1/erechnung_exporte') && log.onedrive.every((a) => a === 'archiv-urls' || a === 'download'), [log.schreibend.map((x) => `${x.m} ${x.p}`), log.onedrive]);

// ---- C) „zuletzt exportiert" + Filter „noch nicht exportiert"
await pg.getByText('noch nie').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
pr('Liste zeigt je Beleg „zuletzt exportiert" (Datum statt „noch nie")', (await pg.locator('tbody tr').allInnerTexts()).every((z) => !z.includes('noch nie') && /\d{2}\.\d{2}\.\d{2}/.test(z.split('\t').pop())));
await pg.getByLabel('Nur noch nicht exportierte Belege').check();
await pg.getByText('Keine archivierten E-Rechnungen im gewählten Zeitraum.').waitFor({ timeout: 8000 });
pr('Filter „noch nicht exportiert": nichts mehr offen, Export-Knopf gesperrt', await pg.getByRole('button', { name: 'ZIP herunterladen' }).isDisabled());
// Zeitraum von–bis: der September-Beleg ist noch nicht exportiert
await pg.getByLabel('Zeitraum von–bis').check();
await pg.locator('#exp-von').fill('2026-09-01');
await pg.locator('#exp-bis').fill('2026-10-31');
await pg.getByText('1 Beleg · 2 Dateien').waitFor({ timeout: 8000 });
pr('Zeitraum von–bis + „noch nicht exportiert": nur der September-Beleg', (await pg.locator('tbody tr').innerText()).includes('Re_26/2950'));
await pg.getByLabel('Nur noch nicht exportierte Belege').uncheck();
await pg.getByText('4 Belege · 7 Dateien').waitFor({ timeout: 8000 });

// ---- D) Hash-Abweichung wird deutlich gemeldet
dateien[`${W}/Re_26_3001.xml`] = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice>NACHTRÄGLICH GEÄNDERT</rsm:CrossIndustryInvoice>');
exporte.length = 0;
const e2 = await exportieren();
const warn = await pg.getByTestId('export-ergebnis').getByRole('alert').innerText();
pr('Abweichung: deutliche Warnung mit Beleg und Datei', warn.includes('Achtung: 1 Datei weicht') && warn.includes('Re_26/3001 · 2026/Re_26_3001.xml') && warn.includes('SHA-256 stimmt nicht'), warn);
const csv2 = e2.zip['Uebersicht.csv'].bytes.toString('utf8');
pr('Abweichung steht in der CSV; übrige Dateien „ok"', /"2026\/Re_26_3001\.xml";"[0-9a-f]{64}";"[^"]*";"ABWEICHUNG \(Datei: [0-9a-f]{64}\)"/.test(csv2) && (csv2.match(/;"ok"/g) ?? []).length === 6, csv2.slice(0, 600));
pr('Export-Protokoll hält die Abweichung fest (hash_ok = false, Hinweis)', exporte.length === 4 && exporte.filter((x) => !x.hash_ok).length === 1 && exporte.find((x) => !x.hash_ok).dokument_id === 'd1'
  && exporte.find((x) => !x.hash_ok).hinweis.includes('Hash-Abweichung'), exporte);
pr('Dateiname bei Zeitraum: E-Rechnungen_2026-09-01_bis_2026-10-31.zip', e2.name === 'E-Rechnungen_2026-09-01_bis_2026-10-31.zip', e2.name);
await pg.screenshot({ path: `${OUT}/export_abweichung_${THEME}.png`, fullPage: true });

await ende(b);
