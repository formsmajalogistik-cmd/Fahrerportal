// Excel-Roundtrip der Tourenliste: Export → dieselbe Datei importieren →
// die importierten Touren stimmen Feld für Feld mit den exportierten überein.
// Zusätzlich: Dubletten werden beim zweiten Import übersprungen, der
// Export mit Auftraggeber-Filter enthält nur diesen Auftraggeber, und der
// Test-Account sieht die Excel-Knöpfe nicht (nur Admin).
// xlsx wird dabei erst beim ersten Gebrauch geladen (Code-Splitting).
//
// Variante „niederlassung" (4. Argument): Müller & Söhne hat zusätzlich die
// Niederlassung „Bremen" (Hauptsitz „Stuhr"); T-2026-0903 gehört zu Bremen.
// Geprüft werden Anzeige „Name · Standort", Filter je Standort, Suche über
// den Standort, Spalte „Niederlassung" im Export und deren Re-Import
// (leer = Hauptsitz).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pw, START, BASIS } from './basis.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light';
const NL_MODUS = process.argv[4] === 'niederlassung';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 800)); } };

const tagVor = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const AGS = [{ id: 'ag1', name: 'Müller & Söhne Autovermietung GmbH', hauptsitz_bezeichnung: NL_MODUS ? 'Stuhr' : null, ort: 'Stuhr' },
  { id: 'ag2', name: 'Nord-Leasing KG', hauptsitz_bezeichnung: null, ort: 'Hamburg' }];
const NLS = NL_MODUS ? [{ id: 'nl1', auftraggeber_id: 'ag1', bezeichnung: 'Bremen', strasse: 'Hafenstraße 5', plz: '28217', ort: 'Bremen', land_code: 'DE',
  rechnungs_email: null, erechnung_email: null, kaeufer_referenz: null, kundennummer: null, ansprechpartner: null, aktiv: true }] : [];
const FAHRER = [{ id: 'f1', user_id: 'u1', aktiv: true, vorname: 'Kemal', nachname: 'Yılmaz', ist_unterkonto: false, haupt_user_id: null,
  user: { email: 'k@x.de', vorname: 'Kemal', nachname: 'Yılmaz' } },
{ id: 'f2', user_id: 'u2', aktiv: true, vorname: 'Jürgen', nachname: 'Groß', ist_unterkonto: false, haupt_user_id: null,
  user: { email: 'j@x.de', vorname: 'Jürgen', nachname: 'Groß' } }];
const leer = { adresse_start: null, adresse_ziel: null, adresse_rueckfuehrung: null, kontakt_start: null, kontakt_ziel: null, kontakt_rueckfuehrung: null,
  fin: null, fin_rueck: null, kundenname: null, fahrzeugmodell: null, fahrzeugmodell_rueck: null, zeit_start: null, zeit_ziel: null, zeit_rueckfuehrung: null,
  strasse_start: null, plz_start: null, strasse_ziel: null, plz_ziel: null, strasse_rueckfuehrung: null, plz_rueckfuehrung: null,
  auf_eis: false, auf_eis_notiz: null, info: null, aba_gesamt_km_berechnen: false, km_rueck: null };
const TOUREN = [
  { ...leer, id: 't1', tour_id: 'T-2026-0901', status: 'geplant', tourenart: 'AB', startdatum: tagVor(6), enddatum: tagVor(5),
    start_stadt: 'Bremen', ziel_stadt: 'München', rueckfuehrung_stadt: null, fahrer_id: 'f1', auftraggeber_id: 'ag1',
    km_hin: 750, km_gesamt: 750, verguetung: 480.5, ist_sondervereinbarung: false, sondervereinbarung: null, kennzeichen: ['HB-AB 123'],
    adresse_start: 'Hafenstraße 1, 28195 Bremen', strasse_start: 'Hafenstraße 1', plz_start: '28195', adresse_ziel: 'Leopoldstraße 9, 80802 München',
    strasse_ziel: 'Leopoldstraße 9', plz_ziel: '80802', kontakt_start: { name: 'Frau Schäfer', telefon: '0421 123', email: 's@kunde.example' },
    fin: 'WVWZZZ1KZAW000001', kundenname: 'Privatkunde Öztürk', fahrzeugmodell: 'VW Golf', zeit_start: '08:30', zeit_ziel: '17:00',
    bestaetigt: true, created_at: `${tagVor(10)}T08:00:00Z` },
  { ...leer, id: 't2', tour_id: 'T-2026-0902', status: 'geplant', tourenart: 'ABA', startdatum: tagVor(4), enddatum: tagVor(4),
    start_stadt: 'Stuhr', ziel_stadt: 'Hamburg', rueckfuehrung_stadt: 'Stuhr', fahrer_id: 'f2', auftraggeber_id: 'ag2',
    km_hin: 120, km_rueck: 120, km_gesamt: 240, verguetung: 211.2, ist_sondervereinbarung: true, sondervereinbarung: 'Pauschale inkl. Bahn „2. Klasse"',
    kennzeichen: ['HB-XY 1', 'HH-RU 77'], fin_rueck: 'WBA00000000000002', fahrzeugmodell_rueck: 'BMW 320d', zeit_rueckfuehrung: '19:15',
    aba_gesamt_km_berechnen: true, strasse_rueckfuehrung: 'Heiligenroder Str. 38e', plz_rueckfuehrung: '28816',
    kontakt_rueckfuehrung: { name: 'Herr Groß', telefon: '', email: '' }, bestaetigt: false, created_at: `${tagVor(9)}T09:30:00Z` },
  { ...leer, id: 't3', tour_id: 'T-2026-0903', status: 'geplant', tourenart: 'AB', startdatum: tagVor(2), enddatum: tagVor(2),
    start_stadt: 'Oldenburg', ziel_stadt: 'Kiel', rueckfuehrung_stadt: null, fahrer_id: null, auftraggeber_id: 'ag1',
    km_hin: 230, km_gesamt: 230, verguetung: 150, ist_sondervereinbarung: false, sondervereinbarung: null, kennzeichen: [],
    auf_eis: true, auf_eis_notiz: 'Kunde meldet sich', bestaetigt: true, created_at: `${tagVor(8)}T10:00:00Z` },
// Im Niederlassungs-Modus ist die Bremer Tour nicht „auf Eis" (sonst stünde
// sie im eingeklappten Bereich und nicht in der Liste).
].map((t) => (NL_MODUS && t.id === 't3' ? { ...t, niederlassung_id: 'nl1', auf_eis: false, auf_eis_notiz: null } : { ...t, niederlassung_id: null }));
const mitJoins = (t) => ({ ...t, auftraggeber: AGS.find((a) => a.id === t.auftraggeber_id) ? { name: AGS.find((a) => a.id === t.auftraggeber_id).name } : null,
  fahrer: FAHRER.find((x) => x.id === t.fahrer_id) ?? null, zusaetze: t.id === 't1' ? [{ kategorie: 'Tankauslagen', anzahl: 1, betrag: 54.2, kennzeichen: 'HB-AB 123', notiz: null }] : [],
  ansprechpartner: [], verguetung: t.verguetung });

const log = { inserts: [], exportAbfragen: [], schreib: [], nlSuche: [] };
let bestand = []; // Touren, die der Dubletten-Abgleich „schon kennt"

async function lauf(rolle, sicht) {
  const b = await pw.chromium.launch(START);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(([uid, theme, s]) => {
    localStorage.setItem('maja-theme', theme);
    localStorage.setItem('maja-logistik-auth', JSON.stringify({ access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } }));
    if (s) localStorage.setItem('maja:test-mode:effective-role', s);
  }, [UID, THEME, sicht]);
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.hostname !== 'stub.supabase.co') return r.continue();
    const p = u.pathname; const sp = u.searchParams; const m = req.method(); const sel = sp.get('select') ?? '';
    const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    const eqW = (k) => (sp.getAll(k).find((x) => x.startsWith('eq.')) ?? '').slice(3);
    const page = (l) => { const o = Number(sp.get('offset') ?? 0); return sp.has('offset') || sp.has('limit') ? l.slice(o, o + Number(sp.get('limit') ?? 1000)) : l; };
    if (m !== 'GET' && m !== 'HEAD') log.schreib.push(`${m} ${p}`);
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
    if (p === '/rest/v1/app_users') { const a = { id: UID, role: rolle, email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null }; return json(obj ? a : [a]); }
    if (p === '/rest/v1/fahrer') { const l = eqW('user_id') ? FAHRER.filter((x) => x.user_id === eqW('user_id')) : FAHRER; return json(obj ? (l[0] ?? null) : l); }
    if (p === '/rest/v1/auftraggeber') return json(obj ? AGS[0] : AGS);
    if (p === '/rest/v1/auftraggeber_niederlassungen') return json(NLS);
    if (p === '/rest/v1/rpc/touren_suche') {
      // Datenbanksuche: kennt nur Tour-Felder (Städte), nicht die Niederlassung.
      const q = String(JSON.parse(req.postData() || '{}').p_suche ?? '').toLowerCase();
      const l = TOUREN.filter((t) => [t.tour_id, t.start_stadt, t.ziel_stadt].some((x) => (x ?? '').toLowerCase().includes(q)));
      return json(l.map((t) => ({ id: t.id, gesamt: l.length })));
    }
    if (p === '/rest/v1/touren') {
      if (m === 'POST') { const x = JSON.parse(req.postData()); log.inserts.push(...(Array.isArray(x) ? x : [x])); return json([], 201); }
      if (sel.replace(/\s/g, '').includes('auftraggeber:auftraggeber_id(name)') && sel.includes('zusaetze:tour_zusaetze')) {
        const nlW = sp.get('niederlassung_id');
        log.exportAbfragen.push({ ag: eqW('auftraggeber_id') || null, nl: nlW });
        const ag = eqW('auftraggeber_id');
        return json(page(TOUREN.filter((t) => (!ag || t.auftraggeber_id === ag)
          && (!nlW || (nlW === 'is.null' ? !t.niederlassung_id : `eq.${t.niederlassung_id}` === nlW))).map(mitJoins)));
      }
      const nlIn = sp.get('niederlassung_id');
      if (sel === 'id' && nlIn?.startsWith('in.(')) {
        const ids = nlIn.slice(4, -1).split(',');
        log.nlSuche.push(ids);
        return json(TOUREN.filter((t) => ids.includes(t.niederlassung_id)).map((t) => ({ id: t.id })));
      }
      if (sel.replace(/\s/g, '') === 'id,startdatum,start_stadt,ziel_stadt,auftraggeber_id') return json(page(bestand));
      if (sel === 'id' || sel.startsWith('kontakt')) return json([]);
      return json(page(TOUREN.map(mitJoins)));
    }
    return json(obj ? null : []);
  });
  const pg = await ctx.newPage();
  const fehler = []; pg.on('pageerror', (e) => fehler.push(e.message));
  await pg.goto(`${BASIS}/touren`);
  await pg.getByText('T-2026-0901').first().waitFor({ timeout: 20000 }).catch(async (e) => { await pg.screenshot({ path: `${OUT}/debug_${rolle}.png`, fullPage: true }); console.log('DEBUG', (await pg.locator('#root').innerText()).slice(0, 800)); throw e; });
  return { b, pg, fehler };
}

// ---- 1) Export als Admin
const { b, pg, fehler } = await lauf('admin');
const sichtbar = async (tid) => (await pg.getByText(tid, { exact: true }).count()) > 0;
if (NL_MODUS) {
  // ---- 0) Anzeige, Filter und Suche je Standort
  const text = await pg.locator('body').innerText();
  pr('Liste: „Müller & Söhne … · Stuhr" (Hauptsitz) und „· Bremen", Nord-Leasing ohne Zusatz',
    /Müller & Söhne[^\n]*· Stuhr/.test(text) && /Müller & Söhne[^\n]*· Bremen/.test(text) && !/Nord-Leasing KG · (Hamburg|Hauptsitz)/.test(text), text.slice(0, 600));
  const optionen = await pg.locator('#t-ag-filter option').allInnerTexts();
  pr('Filter: Auftraggeber (alle Standorte), Hauptsitz und Niederlassung einzeln wählbar',
    optionen.some((o) => o.includes('Müller & Söhne Autovermietung GmbH (alle Standorte)')) && optionen.some((o) => o.includes('· Stuhr'))
      && optionen.some((o) => o.includes('· Bremen')) && optionen.some((o) => o.trim() === 'Nord-Leasing KG'), optionen);
  await pg.locator('#t-ag-filter').selectOption('ag1:nl1'); await pg.waitForTimeout(400);
  // (T-2026-0902 steht unter „Zur Bestätigung" — dieser Bereich ist unabhängig vom Filter.)
  const nurBremen = (await sichtbar('T-2026-0903')) && !(await sichtbar('T-2026-0901'));
  await pg.locator('#t-ag-filter').selectOption('ag1:hs'); await pg.waitForTimeout(400);
  const nurHs = (await sichtbar('T-2026-0901')) && !(await sichtbar('T-2026-0903'));
  await pg.locator('#t-ag-filter').selectOption('ag1'); await pg.waitForTimeout(400);
  const beide = (await sichtbar('T-2026-0901')) && (await sichtbar('T-2026-0903'));
  pr('Filter: Bremen → nur Bremer Tour, Hauptsitz → nur Hauptsitz, Auftraggeber → beide', nurBremen && nurHs && beide, { nurBremen, nurHs, beide });
  await pg.locator('#t-ag-filter').selectOption(''); await pg.waitForTimeout(300);
  const feld = pg.getByPlaceholder('Tour-ID, Stadt, Fahrer, Kennzeichen ...');
  await feld.fill('Bremen');
  await pg.getByText('Suche in allen Touren').first().waitFor({ timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(500);
  pr('Suche „Bremen" findet auch die Tour der Niederlassung Bremen (Oldenburg → Kiel)',
    (await sichtbar('T-2026-0903')) && (await sichtbar('T-2026-0901')) && log.nlSuche.some((l) => l.includes('nl1')), log.nlSuche);
  await pg.screenshot({ path: `${OUT}/niederlassung_suche_${THEME}.png` });
  await feld.fill(''); await pg.waitForTimeout(600);
}
const xlsxGeladen = [];
pg.on('request', (q) => { if (/xlsx/i.test(new URL(q.url()).pathname)) xlsxGeladen.push(q.url()); });
const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.getByRole('button', { name: 'Export (Excel)' }).click()]);
const datei = `${OUT}/${dl.suggestedFilename()}`;
writeFileSync(datei, readFileSync(await dl.path()));
pr('Export: xlsx wird erst beim Klick nachgeladen', xlsxGeladen.length > 0, xlsxGeladen.length);
const wb = XLSX.readFile(datei);
const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Touren, { header: 1, defval: '' });
pr('Export: Blätter Touren + Zusätze, Kopfzeile in Zeile 2, 3 Touren', wb.SheetNames.includes('Touren') && wb.SheetNames.includes('Zusätze')
  && aoa[1][0] === 'Datum' && aoa[1][1] === 'Fahrauftrag' && aoa.length === 5, { blaetter: wb.SheetNames, zeilen: aoa.length });
const zeile = (tid) => aoa.find((z) => z.includes(tid));
pr('Export: Sonderzeichen, Route, Fahrer, Auftraggeber korrekt', zeile('T-2026-0901')[1] === 'Bremen / München' && zeile('T-2026-0901')[3] === AGS[0].name
  && zeile('T-2026-0902')[5] === 'Pauschale inkl. Bahn „2. Klasse"' && zeile('T-2026-0902')[1] === 'Stuhr / Hamburg / Stuhr' && /Groß/.test(zeile('T-2026-0902')[2]), [zeile('T-2026-0901').slice(0, 9), zeile('T-2026-0902').slice(0, 9)]);
{
  const nlSpalte = aoa[1].indexOf('Niederlassung');
  pr(NL_MODUS ? 'Export: Spalte „Niederlassung" — T-2026-0903 „Bremen", übrige leer (= Hauptsitz)' : 'Export: Spalte „Niederlassung" vorhanden und leer',
    nlSpalte > 0 && zeile('T-2026-0903')[nlSpalte] === (NL_MODUS ? 'Bremen' : '') && zeile('T-2026-0901')[nlSpalte] === '' && zeile('T-2026-0902')[nlSpalte] === '',
    { nlSpalte, werte: ['T-2026-0901', 'T-2026-0902', 'T-2026-0903'].map((x) => zeile(x)[nlSpalte]) });
}
const zus = XLSX.utils.sheet_to_json(wb.Sheets['Zusätze'], { header: 1, defval: '' });
pr('Export: Zusatz (Tankauslagen 54,20) im Blatt „Zusätze"', JSON.stringify(zus).includes('Tankauslagen') && JSON.stringify(zus).includes('54.2'), zus.slice(0, 4));

// ---- 2) Dieselbe Datei importieren (leerer Bestand) → identische Daten
async function importieren(name, erwarteInserts) {
  await pg.getByRole('button', { name: 'Touren importieren' }).click();
  const dlg = pg.getByRole('dialog').last();
  await pg.locator('input[type=file]').setInputFiles(datei);
  await pg.getByRole('button', { name: 'Sheet einlesen' }).click();
  await pg.getByRole('button', { name: 'Weiter zur Vorschau' }).click({ timeout: 20000 });
  await pg.getByRole('button', { name: /^Alle importieren/ }).click({ timeout: 20000 });
  let text = '';
  if (erwarteInserts) {
    // Nach erfolgreichem Import lädt die Liste neu (bestehendes Verhalten:
    // der Dialog startet dabei neu) — deshalb auf die Einfügungen warten.
    for (let i = 0; i < 100 && log.inserts.length < erwarteInserts; i++) await pg.waitForTimeout(200);
    await pg.waitForTimeout(800);
  } else {
    await pg.getByText('Übersprungen', { exact: true }).waitFor({ timeout: 20000 });
    text = await dlg.innerText();
  }
  await pg.screenshot({ path: `${OUT}/import_${name}_${THEME}.png` });
  const zu = pg.getByRole('button', { name: /^(Schließen|Abbrechen)$/ }).last();
  if (await zu.count()) await zu.click();
  return text;
}
log.inserts = [];
await importieren('leer', 3);
pr('Import: alle 3 Touren eingefügt', log.inserts.length === 3, log.inserts.length);
const VERGLEICH = ['startdatum', 'enddatum', 'start_stadt', 'ziel_stadt', 'rueckfuehrung_stadt', 'fahrer_id', 'auftraggeber_id', 'tourenart',
  'ist_sondervereinbarung', 'sondervereinbarung', 'km_hin', 'km_rueck', 'km_gesamt', 'verguetung', 'kennzeichen', 'adresse_start', 'adresse_ziel',
  'adresse_rueckfuehrung', 'kontakt_start', 'kontakt_ziel', 'kontakt_rueckfuehrung', 'fin', 'fin_rueck', 'kundenname', 'status', 'bestaetigt',
  'fahrzeugmodell', 'fahrzeugmodell_rueck', 'zeit_start', 'zeit_ziel', 'zeit_rueckfuehrung', 'aba_gesamt_km_berechnen', 'strasse_start', 'plz_start',
  'strasse_ziel', 'plz_ziel', 'strasse_rueckfuehrung', 'plz_rueckfuehrung', 'auf_eis', 'auf_eis_notiz', 'niederlassung_id'];
const norm = (k, v) => {
  if (v === '' || v === undefined) v = null;
  if (k === 'kontakt_start' || k === 'kontakt_ziel' || k === 'kontakt_rueckfuehrung') {
    if (!v) return null;
    const o = { name: v.name || '', telefon: v.telefon || '', email: v.email || '' };
    return o.name || o.telefon || o.email ? JSON.stringify(o) : null;
  }
  if (k === 'kennzeichen') return JSON.stringify(Array.isArray(v) ? v.filter(Boolean) : []);
  if (k === 'sondervereinbarung' && v === null) return null;
  if (typeof v === 'number') return Number(v.toFixed(2));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && (k.endsWith('datum'))) return v.slice(0, 10);
  return v;
};
const abweichungen = [];
for (const t of TOUREN) {
  const neu = log.inserts.find((x) => x.start_stadt === t.start_stadt && x.ziel_stadt === t.ziel_stadt);
  if (!neu) { abweichungen.push({ tour: t.tour_id, fehlt: true }); continue; }
  for (const k of VERGLEICH) {
    const a = norm(k, t[k]); const n = norm(k, neu[k]);
    if (JSON.stringify(a) !== JSON.stringify(n)) abweichungen.push({ tour: t.tour_id, feld: k, export: a, import: n });
  }
}
pr(`Roundtrip: ${VERGLEICH.length} Felder je Tour identisch (Export → Import)`, abweichungen.length === 0, abweichungen);
if (NL_MODUS) {
  const nlVon = (stadt) => log.inserts.find((x) => x.start_stadt === stadt)?.niederlassung_id;
  pr('Import: „Bremen" → Niederlassung Bremen, leere Spalte → Hauptsitz (null)',
    nlVon('Oldenburg') === 'nl1' && nlVon('Bremen') === null && nlVon('Stuhr') === null, log.inserts.map((x) => [x.start_stadt, x.niederlassung_id]));
}

// ---- 3) Dieselbe Datei gegen vorhandenen Bestand → Vorschau warnt vor Duplikaten
bestand = TOUREN.map((t) => ({ id: t.id, startdatum: t.startdatum, start_stadt: t.start_stadt, ziel_stadt: t.ziel_stadt, auftraggeber_id: t.auftraggeber_id }));
log.inserts = [];
{
  const offen = pg.getByRole('button', { name: /^(Schließen|Abbrechen)$/ });
  if (await pg.locator('input[type=file]').count()) await offen.last().click();
  await pg.getByRole('button', { name: 'Touren importieren' }).click();
  await pg.locator('input[type=file]').setInputFiles(datei);
  await pg.getByRole('button', { name: 'Sheet einlesen' }).click();
  await pg.getByRole('button', { name: 'Weiter zur Vorschau' }).click({ timeout: 20000 });
  const warnung = pg.getByText(/3 Zeile\(n\) sind möglicherweise Duplikate/);
  await warnung.waitFor({ timeout: 10000 }).catch(() => {});
  pr('Erneuter Import: Vorschau markiert alle 3 als mögliche Duplikate, ohne Klick wird nichts angelegt',
    (await warnung.count()) === 1 && log.inserts.length === 0, log.inserts.length);
  await pg.getByRole('button', { name: 'Zurück' }).last().click();
  await pg.getByRole('button', { name: /^(Schließen|Abbrechen)$/ }).last().click().catch(() => {});
  await pg.keyboard.press('Escape');
}

// ---- 4) Export mit Auftraggeber-Filter
await pg.locator('#t-ag-filter').selectOption('ag2');
await pg.waitForTimeout(600);
const [dl2] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.getByRole('button', { name: 'Export (Excel)' }).click()]);
const wb2 = XLSX.read(readFileSync(await dl2.path()));
const aoa2 = XLSX.utils.sheet_to_json(wb2.Sheets.Touren, { header: 1, defval: '' });
pr('Export mit Auftraggeber-Filter: nur Touren dieses Auftraggebers', log.exportAbfragen.at(-1)?.ag === 'ag2' && aoa2.length === 3 && aoa2[2].includes('T-2026-0902'), { abfrage: log.exportAbfragen.at(-1), zeilen: aoa2.length });
if (NL_MODUS) {
  await pg.locator('#t-ag-filter').selectOption('ag1:nl1');
  await pg.waitForTimeout(600);
  const [dl3] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.getByRole('button', { name: 'Export (Excel)' }).click()]);
  const aoa3 = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(await dl3.path())).Sheets.Touren, { header: 1, defval: '' });
  const a = log.exportAbfragen.at(-1);
  pr('Export mit Filter „Bremen": nur Touren der Niederlassung', a?.ag === 'ag1' && a?.nl === 'eq.nl1' && aoa3.length === 3 && aoa3[2].includes('T-2026-0903'), { abfrage: a, zeilen: aoa3.length });
}
pr('Keine Fehler im Ablauf', fehler.length === 0, fehler);
await b.close();

// ---- 5) Test-Account: keine Excel-Knöpfe (nur Admin), Tourenliste lädt
{
  const t = await lauf('test', 'fahrer');
  pr('Test-Account: Tourenliste lädt, Export/Import nicht angeboten', (await t.pg.getByRole('button', { name: 'Export (Excel)' }).count()) === 0
    && (await t.pg.getByRole('button', { name: 'Touren importieren' }).count()) === 0 && t.fehler.length === 0, t.fehler);
  await t.b.close();
}
console.log(f ? `${f} FEHLER` : 'alle ok');
process.exit(f ? 1 : 0);
