import { pw, START, BASIS, standortWaehlen } from './basis.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const SCHEMA = process.argv[4] ?? 'mit'; const MOBIL = process.argv[5] === 'mobil';
const MIT = SCHEMA === 'mit';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i)); } };
const AG = {
  id: 'ag1', name: 'Arval', kontakt: null, strasse: 'Hauptstr. 1', plz: '85609', ort: 'Aschheim', email1: null, email2: null,
  preisliste_pdf_url: null, aba_aufschlag_prozent: 10, externe_app_name: null, externe_app_url: null, rechnungsformat: null,
  kundennummer: 'K-1', sachbearbeiter: null, kunden_uid: 'DE111111111', zahlungsziel_tage: 14,
  ...(MIT ? { land_code: null, erechnung_format: 'pdf', erechnung_email: null, kaeufer_referenz: null } : {}),
};
const RA = { id: 'ra1', auftraggeber_id: 'ag1', firma: 'Arval Rechnung', ansprechpartner: null, strasse: 'Weg 2', plz_ort: '85609 Aschheim', land: 'Deutschland', ist_standard: true, created_at: '2026-01-01T00:00:00Z',
  ...(MIT ? { plz: null, ort: null, land_code: null } : {}) };
const RE = {
  mit_unterschrift: true, mit_stempel: true, id: 're1', rechnungsnummer: 'Re_26/0100', auftraggeber_id: 'ag1', rechnungsadresse_id: null,
  datum: '2026-10-30', leistungszeitraum_von: '2026-10-01', leistungszeitraum_bis: '2026-10-31', anrede: null,
  netto_summe: 403.2, ust_satz: 19, ust_betrag: 76.61, brutto_summe: 479.81, status: 'offen', bezahlt_am: null, pdf_url: null, belege_pdf_url: null,
  email_versendet_am: null, notizen: null, ist_auslagen_rechnung: false, ansprechpartner: null, sachbearbeiter: null, kundennummer: 'K-1',
  rechnungsadresse_firma: 'Arval & Co <Test>', rechnungsadresse_strasse: 'Weg 2', rechnungsadresse_plz_ort: '85609 Aschheim', rechnungsadresse_land: 'Deutschland',
  empfaenger_typ: 'auftraggeber', empfaenger_email: null, empfaenger_ust_id: null, rechnungsempfaenger_id: null, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z',
  ...(MIT ? { faellig_am: null, zahlungsziel_tage: null, rechnungsadresse_plz: null, rechnungsadresse_ort: null, rechnungsadresse_land_code: null, erechnung_format: null, erechnung_email: null, kaeufer_referenz: null } : {}),
};
const POS = [
  { id: 'p1', rechnung_id: 're1', position_nr: 1, bezeichnung: 'Überführung Bremen nach Hamburg', unterzeilen: ['HB-AB 1'], menge: 1, einzelpreis: 192, gesamtpreis: 192, tour_id: 't1', zusatz_id: null, ist_manuell: false, ust_satz: null, created_at: 'x' },
  { id: 'p2', rechnung_id: 're1', position_nr: 2, bezeichnung: 'ABA Bremen – Kiel – Bremen', unterzeilen: [], menge: 1, einzelpreis: 211.2, gesamtpreis: 211.2, tour_id: 't2', zusatz_id: null, ist_manuell: false, ust_satz: null, created_at: 'x' },
];
let einst = { standard_zahlungsziel_tage: 14 };
let gemerkt = [];
const log = { schreib: [], patchAg: [], patchRa: [], postMe: [], postRe: [], upsert: [], onedrive: 0 };

const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL, acceptDownloads: true });
await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
  access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (u.pathname.startsWith('/api/onedrive')) { log.onedrive++; return r.fulfill({ status: 500, body: 'nein' }); }
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const p = u.pathname; const sp = u.searchParams; const m = req.method(); const sel = sp.get('select') ?? '';
  const body = () => { try { return JSON.parse(req.postData() ?? 'null'); } catch { return null; } };
  if (m !== 'GET' && m !== 'HEAD' && p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/')) log.schreib.push(`${m} ${p}`);
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/fahrer') return json(obj ? null : []);
  if (p === '/rest/v1/app_settings') {
    if (m === 'POST') { const x = body(); log.upsert.push(x); if (x?.key === 'rechnung_einstellungen') einst = x.value; return json(x, 201); }
    const key = (sp.get('key') ?? '').slice(3);
    if (key === 'rechnung_einstellungen') return json(MIT ? { value: einst } : null);
    return json(obj ? null : []);
  }
  if (p === '/rest/v1/auftraggeber') {
    if (m === 'PATCH') { log.patchAg.push(body()); return json([], 200); }
    const l = [{ ...AG, ...(sel.includes('rechnungsadressen') ? { rechnungsadressen: [RA] } : {}) }];
    return json(obj ? l[0] : l);
  }
  if (p === '/rest/v1/auftraggeber_kontakte') return json([]);
  if (p === '/rest/v1/rechnungsadressen') {
    if (m === 'PATCH') { log.patchRa.push(body()); return json([], 200); }
    return json([RA]);
  }
  if (p === '/rest/v1/manuelle_empfaenger') {
    if (m === 'POST') { const x = body(); log.postMe.push(x); gemerkt.push({ id: `me${gemerkt.length + 1}`, created_at: 'x', updated_at: 'x', notiz: null, ...x }); return json([], 201); }
    return json(gemerkt);
  }
  if (p === '/rest/v1/rechnungen') {
    if (sel === 'faellig_am') return MIT ? json([]) : json({ code: '42703', message: 'column rechnungen.faellig_am does not exist' }, 400);
    if (m === 'POST') { const x = body(); log.postRe.push(x); return json({ id: 're9', rechnungsnummer: 'Re_26/0101' }, 201); }
    if (sp.get('id') === 'eq.re1' || sp.get('id') === 'eq.re9') return json(obj ? { ...RE, auftraggeber: AG } : [{ ...RE, auftraggeber: AG }]);
    return json(obj ? null : [RE]);
  }
  if (p === '/rest/v1/rechnungspositionen') {
    if (m === 'POST') return json([], 201);
    return json(sp.get('rechnung_id') === 'eq.re1' ? POS : []);
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('pageerror', e.message));
const B = BASIS;

// ------------------------------------------------------------ A) E-Rechnung (Test)
await pg.goto(`${B}/einstellungen/erechnung-test`);
if (!MIT) {
  await pg.getByText('Migration 115 fehlt').waitFor({ timeout: 15000 });
  pr('ohne Migration: Test-Seite meldet fehlende Migration', true);
} else {
  await pg.getByText('Nur zur Prüfung — nicht an Kunden senden.', { exact: false }).waitFor({ timeout: 15000 });
  pr('Hinweis „Nur zur Prüfung — nicht an Kunden senden" sichtbar', true);
  await pg.getByRole('button', { name: /Re_26\/0100/ }).click();
  await pg.getByTestId('ert-ergebnis').waitFor({ timeout: 10000 });
  const txt = await pg.getByTestId('ert-ergebnis').innerText();
  pr('Pflichtfeld-Prüfung: Kontaktname, E-Rechnungs-Adresse, Käuferreferenz gemeldet',
    txt.includes('Kontaktname des Absenders fehlt (Pflicht bei XRechnung)') && txt.includes('E-Rechnungs-Adresse fehlt (Pflicht bei XRechnung)') && txt.includes('Käuferreferenz fehlt (Pflicht bei XRechnung)'), txt);
  pr('Altrechnung: PLZ/Ort + Land für den Test abgeleitet (Hinweis)', txt.includes('PLZ/Ort für den Test aus „85609 Aschheim" abgeleitet') && txt.includes('Ländercode DE für den Test'), txt);
  pr('Summen wie im PDF (403,20 / 76,61 / 479,81)', txt.includes('403,20') && txt.includes('76,61') && txt.includes('479,81'), txt);
  await pg.screenshot({ path: `${OUT}/ert_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: true });
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByRole('button', { name: 'XML herunterladen (_TEST)' }).click()]);
  const inhalt = readFileSync(await dl.path(), 'utf8');
  pr('Download: Dateiname Re_26_0100_TEST.xml', dl.suggestedFilename() === 'Re_26_0100_TEST.xml', dl.suggestedFilename());
  pr('Download: Testkennzeichnung + Rechnungsnummer + escaped Name', inhalt.includes('TESTDATEI — nur zur Prüfung, NICHT an Kunden senden') && inhalt.includes('<ram:ID>Re_26/0100</ram:ID>') && inhalt.includes('Arval &amp; Co &lt;Test&gt;'), inhalt.slice(0, 300));
  pr('Test-Export schreibt nichts (keine POST/PATCH/DELETE, kein OneDrive)', log.schreib.length === 0 && log.onedrive === 0, [log.schreib, log.onedrive]);
  // Format EN 16931
  await pg.locator('#ert-profil').selectOption('en16931');
  await pg.getByText('Pflichtfeld-Prüfung (EN 16931)').waitFor({ timeout: 8000 });
  const txt2 = await pg.getByTestId('ert-ergebnis').innerText();
  pr('Format EN 16931: Kontaktname nur Hinweis', !txt2.includes('Fehlt / ungültig: Kontaktname'), txt2);
  // Format ZUGFeRD: EIN PDF mit eingebettetem XML, ebenfalls ohne Schreibzugriff
  await pg.locator('#ert-profil').selectOption('zugferd');
  await pg.getByText('Pflichtfeld-Prüfung (ZUGFeRD (EN 16931))').waitFor({ timeout: 8000 });
  const [dz] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.getByRole('button', { name: 'ZUGFeRD-PDF herunterladen (_TEST)' }).click()]);
  const zf = readFileSync(await dz.path());
  writeFileSync(`${OUT}/${dz.suggestedFilename()}`, zf);
  const zfText = zf.toString('latin1');
  pr('ZUGFeRD-Test-Export: Dateiname Re_26_0100_TEST.pdf', dz.suggestedFilename() === 'Re_26_0100_TEST.pdf', dz.suggestedFilename());
  pr('ZUGFeRD-Test-Export: PDF mit Anhang factur-x.xml und PDF/A-3-Kennung', zfText.startsWith('%PDF-') && zfText.includes('factur-x.xml') && zfText.includes('<pdfaid:part>3</pdfaid:part>') && zfText.includes('/AFRelationship /Alternative'), zfText.slice(0, 40));
  pr('ZUGFeRD-Test-Export schreibt nichts', log.schreib.length === 0 && log.onedrive === 0, [log.schreib, log.onedrive]);
}
if (MOBIL) { await b.close(); console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0); }

// ------------------------------------------------------------ B) Auftraggeber-Dialog
await pg.goto(`${B}/einstellungen/auftraggeber`);
await pg.getByRole('button', { name: 'Bearbeiten' }).first().click();
await pg.getByLabel('Name *').first().waitFor({ timeout: 10000 });
await pg.waitForTimeout(500);
if (MIT) {
  const opts = await pg.locator('#ag-format option').evaluateAll((os) => os.map((o) => `${o.textContent}|${o.disabled}`));
  // ZUGFeRD ist erst wählbar, wenn ZUGFERD_FREIGESCHALTET gesetzt ist.
  const zugferdFrei = /ZUGFERD_FREIGESCHALTET = true/.test(readFileSync(new URL('../../src/lib/erechnung/stammdaten.ts', import.meta.url), 'utf8'));
  pr(`Format: PDF, EN 16931 und XRechnung wählbar; ZUGFeRD ${zugferdFrei ? 'wählbar' : 'gesperrt („folgt")'}`,
    opts.length === 4 && opts[0] === 'PDF (wie bisher)|false' && opts[1].startsWith('E-Rechnung EN 16931') && opts[1].endsWith('|false') && opts[2].startsWith('XRechnung') && opts[2].endsWith('|false')
    && opts[3] === (zugferdFrei ? 'ZUGFeRD (PDF mit eingebettetem XML)|false' : 'ZUGFeRD (PDF mit eingebettetem XML) — folgt|true'), opts);
  pr('Bestand ohne Ländercode bleibt leer (kein Raten)', (await pg.locator('#ag-land-code').inputValue()) === '');
  await pg.locator('#ag-erech-email').fill('eingang@arval.example');
  await pg.locator('#ag-referenz').fill('LW-123');
  // Rechnungsadresse: Übernahme aus „PLZ / Ort"
  await pg.getByRole('button', { name: 'Aus „PLZ / Ort" übernehmen' }).click();
  pr('Rechnungsadresse: PLZ/Ort/Land übernommen', (await pg.getByTestId('ra-erechnung').locator('input').evaluateAll((is) => is.map((i) => i.value))).join('|') === '85609|Aschheim|DE');
  await pg.screenshot({ path: `${OUT}/ag_dialog_${THEME}.png`, fullPage: true });
  await pg.getByRole('button', { name: 'Aktualisieren' }).click();
  await pg.waitForTimeout(400);
  pr('Rechnungsadresse gespeichert mit plz/ort/land_code, plz_ort unverändert', JSON.stringify(log.patchRa.find((x) => 'firma' in x)).includes('"plz":"85609","ort":"Aschheim","land_code":"DE"') && log.patchRa.find((x) => 'firma' in x)?.plz_ort === '85609 Aschheim', log.patchRa);
} else {
  pr('ohne Migration: kein E-Rechnungs-Block', (await pg.locator('#ag-format').count()) === 0 && (await pg.getByTestId('ra-erechnung').count()) === 0);
}
await pg.getByRole('button', { name: 'Speichern', exact: true }).click();
await pg.waitForTimeout(600);
const agBody = log.patchAg.at(-1) ?? {};
if (MIT) pr('Auftraggeber gespeichert: land_code null, Format pdf, E-Mail + Referenz', agBody.land_code === null && agBody.erechnung_format === 'pdf' && agBody.erechnung_email === 'eingang@arval.example' && agBody.kaeufer_referenz === 'LW-123', agBody);
else pr('ohne Migration: Auftraggeber-Speichern ohne neue Spalten', agBody.name === 'Arval' && !('land_code' in agBody) && !('erechnung_format' in agBody), agBody);

// ------------------------------------------------------------ C) Manuelle Empfänger
await pg.goto(`${B}/einstellungen/manuelle-empfaenger`);
await pg.getByRole('button', { name: '+ Neuer Empfänger' }).waitFor({ timeout: 10000 });
if (MIT) {
  // Seit Phase 1b wird das Standard-Zahlungsziel unter „Firmendaten (Rechnungen)" gepflegt;
  // hier steht nur noch der Hinweis mit Verweis dorthin.
  const hinweis = pg.getByTestId('standard-zahlungsziel-hinweis');
  await hinweis.getByText('14 Tage').waitFor({ timeout: 8000 });
  pr('Standard-Zahlungsziel: Hinweis mit aktuellem Wert und Verweis auf die Firmendaten',
    (await hinweis.getByRole('link').getAttribute('href')) === '/einstellungen/firmendaten' && (await pg.locator('#standard-zahlungsziel').count()) === 0, await hinweis.innerText());
  einst = { standard_zahlungsziel_tage: 21 }; // so, als wäre es dort auf 21 geändert worden
} else {
  pr('ohne Migration: keine Standard-Zahlungsziel-Einstellung', (await pg.getByTestId('standard-zahlungsziel-hinweis').count()) === 0);
}
await pg.getByRole('button', { name: '+ Neuer Empfänger' }).click();
await pg.locator('#me-firma').fill('Sub GmbH');
await pg.locator('#me-plz').fill('28195');
await pg.locator('#me-ort').fill('Bremen');
if (MIT) {
  pr('Neuer Empfänger: Ländercode DE vorbelegt', (await pg.locator('#me-er-land-code').inputValue()) === 'DE');
  await pg.locator('#me-zahlungsziel').fill('10');
}
await pg.locator('section.card').getByRole('button', { name: 'Speichern' }).last().click();
await pg.waitForTimeout(600);
const me = log.postMe.at(-1) ?? {};
if (MIT) pr('Empfänger gespeichert mit land_code DE, Ziel 10, Format pdf', me.land_code === 'DE' && me.zahlungsziel_tage === 10 && me.erechnung_format === 'pdf', me);
else pr('ohne Migration: Empfänger ohne neue Spalten', me.firma === 'Sub GmbH' && !('land_code' in me), me);

// ------------------------------------------------------------ D) Manuelle Rechnung
await pg.goto(`${B}/rechnungen/neu`);
await standortWaehlen(pg, '#ag', 'Manuell');
await pg.locator('#re-man-firma').fill('Privat Test & Sohn');
await pg.locator('#re-man-plz').fill('26122');
await pg.locator('#re-man-ort').fill('Oldenburg');
if (MIT) {
  const ph = await pg.locator('#re-man-zahlungsziel').getAttribute('placeholder');
  pr('Manuelle Rechnung: Zahlungsziel-Feld mit Standard als Platzhalter', ph === '21 (Standard)', ph);
  pr('Manuelle Rechnung: E-Rechnungs-Block sichtbar', (await pg.getByTestId('re-man-er-erechnung').count()) === 1);
  await pg.screenshot({ path: `${OUT}/re_manuell_${THEME}.png`, fullPage: true });
} else {
  pr('ohne Migration: kein Zahlungsziel-Feld', (await pg.locator('#re-man-zahlungsziel').count()) === 0);
}
await pg.getByRole('button', { name: 'Als Entwurf speichern' }).click();
await pg.waitForTimeout(1200);
const re = log.postRe.at(-1) ?? {};
if (MIT) pr('Rechnung angelegt: Snapshot plz/ort/land, Ziel = Standard 21, Format pdf; plz_ort wie bisher', re.rechnungsadresse_plz === '26122' && re.rechnungsadresse_ort === 'Oldenburg' && re.rechnungsadresse_land_code === 'DE' && re.zahlungsziel_tage === 21 && re.erechnung_format === 'pdf' && re.rechnungsadresse_plz_ort === '26122 Oldenburg', re);
else pr('ohne Migration: Rechnung ohne neue Spalten', re.rechnungsadresse_plz_ort === '26122 Oldenburg' && !('rechnungsadresse_plz' in re) && !('zahlungsziel_tage' in re), re);

await b.close();
console.log(f ? `${f} FEHLER` : 'alle ok');
process.exit(f ? 1 : 0);
