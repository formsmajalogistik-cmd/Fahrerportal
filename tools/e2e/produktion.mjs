// Tests gegen den PRODUKTIONS-Build (npm run test:e2e:prod)
//
// Die übrigen Browsertests laufen gegen den Entwicklungsserver; Code-
// Splitting, Service Worker und Versionswechsel gibt es aber nur im
// echten Build. Dieser Läufer
//   1. baut die App zweimal (Version A und B — B mit anderen Dateinamen,
//      wie nach einem echten Deploy),
//   2. liefert sie über einen kleinen Server aus, der zwischen A und B
//      umschalten kann (alte Programmteile verschwinden dann),
//   3. prüft: alle Seiten je Rolle laden; Versionswechsel ohne weißen
//      Bildschirm (Neuladen bzw. Hinweis, Schutz gegen Endlosschleife);
//      Service Worker hält auch nachgeladene Teile vor; Fahrer-Formular
//      offline ausfüllen und nach dem Wiederverbinden abgleichen.
// Alle Daten sind erfunden; Supabase wird im Browser abgefangen.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pw, START } from './basis.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const AUS = resolve(HIER, '.ausgabe', 'produktion');
const PORT = Number(process.env.E2E_PROD_PORT ?? 5197);
const BASIS = `http://localhost:${PORT}`;
const UID = '00000000-0000-0000-0000-0000000000a1';

let fehler = 0;
const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { fehler++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 500)); } };

// ---------------------------------------------------------------- Builds
rmSync(AUS, { recursive: true, force: true });
mkdirSync(AUS, { recursive: true });
const env = { ...process.env, VITE_SUPABASE_URL: 'https://stub.supabase.co', VITE_SUPABASE_ANON_KEY: 'stub-anon-key' };
function bauen(ziel, config) {
  const args = [resolve(WURZEL, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', ziel, '--emptyOutDir'];
  if (config) args.push('--config', config);
  const r = spawnSync(process.execPath, args, { cwd: WURZEL, env, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(2); }
}
console.log('Baue Version A und B …');
bauen(join(AUS, 'a'));
const configB = join(AUS, 'vite.b.config.mjs');
writeFileSync(configB, `import { mergeConfig } from 'vite';
import basis from '${resolve(WURZEL, 'vite.config.ts').replace(/\\/g, '/')}';
export default mergeConfig(basis, { build: { rolldownOptions: { output: {
  entryFileNames: 'assets/b-[name]-[hash].js', chunkFileNames: 'assets/b-[name]-[hash].js' } } } });
`);
bauen(join(AUS, 'b'), configB);
// Version „B kaputt": wie B, aber ein Programmteil fehlt (Schleifenschutz)
cpSync(join(AUS, 'b'), join(AUS, 'b-kaputt'), { recursive: true });
const bRechnungen = readdirSync(join(AUS, 'b-kaputt', 'assets')).find((f) => /^b-RechnungenListPage-.*\.js$/.test(f));
rmSync(join(AUS, 'b-kaputt', 'assets', bRechnungen));

// ---------------------------------------------------------------- 0) Entscheidungslogik
// Neu laden oder nur Hinweis? (src/lib/neueVersion.ts, ohne Browser)
{
  const { build } = await import('esbuild');
  const ziel = join(AUS, 'neueVersion.mjs');
  await build({ entryPoints: [resolve(WURZEL, 'src/lib/neueVersion.ts')], outfile: ziel, bundle: true, format: 'esm', platform: 'neutral', logLevel: 'warning' });
  const speicher = new Map(); let neuGeladen = 0; const hinweise = [];
  globalThis.sessionStorage = { getItem: (k) => speicher.get(k) ?? null, setItem: (k, v) => speicher.set(k, String(v)), removeItem: (k) => speicher.delete(k) };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  globalThis.window = { location: { reload: () => { neuGeladen++; } }, dispatchEvent: (e) => { hinweise.push(e.detail); return true; } };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  const nv = await import(ziel);
  const warnAlt = console.warn; console.warn = () => {}; // erwartete Warnungen der Logik nicht ausgeben
  const fehlerObj = new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js');
  console.log('0) Entscheidung beim fehlenden Programmteil');
  pr('Ladefehler wird erkannt (Chrome, Firefox, Safari), andere Fehler nicht',
    nv.istChunkLadefehler(fehlerObj) && nv.istChunkLadefehler(new Error('error loading dynamically imported module'))
    && nv.istChunkLadefehler(new TypeError('Importing a module script failed.')) && !nv.istChunkLadefehler(new Error('Netzwerkfehler')));
  const ab = nv.meldeOffeneArbeit('Formular af1', () => true);
  pr('Ungesicherte Eingaben → NICHT neu laden, nur Hinweis (mit Grund)', nv.beiChunkLadefehler(fehlerObj) === 'hinweis' && neuGeladen === 0 && hinweise.at(-1)?.offen?.[0] === 'Formular af1');
  ab();
  navigator.onLine = false;
  pr('Offline → nicht neu laden, nur Hinweis', nv.beiChunkLadefehler(fehlerObj) === 'hinweis' && neuGeladen === 0);
  navigator.onLine = true;
  pr('Nichts offen → einmal neu laden', nv.beiChunkLadefehler(fehlerObj) === 'neu-laden' && neuGeladen === 1);
  pr('Zweiter Fehler innerhalb von 2 Minuten → kein weiteres Neuladen (Schleifenschutz)', nv.beiChunkLadefehler(fehlerObj) === 'hinweis' && neuGeladen === 1);
  nv.jetztNeuLaden();
  pr('Knopf „Neu laden" setzt den Schutz zurück und lädt neu', neuGeladen === 2 && speicher.size === 0);
  delete globalThis.window;
  console.warn = warnAlt;
}

// ---------------------------------------------------------------- Server
let aktiv = 'a';
const TYP = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const anfragen = [];
const server = createServer((req, res) => {
  const pfad = decodeURIComponent(new URL(req.url, BASIS).pathname);
  anfragen.push(pfad);
  const wurzel = join(AUS, aktiv);
  let datei = join(wurzel, pfad);
  const vorhanden = existsSync(datei) && statSync(datei).isFile();
  if (!vorhanden) {
    if (pfad.startsWith('/assets/') || extname(pfad)) { res.writeHead(404); res.end('nicht gefunden'); return; }
    datei = join(wurzel, 'index.html'); // SPA-Fallback wie vercel.json
  }
  res.writeHead(200, { 'content-type': TYP[extname(datei)] ?? 'application/octet-stream', 'cache-control': pfad === '/sw.js' ? 'no-cache' : 'public, max-age=0' });
  res.end(readFileSync(datei));
});
await new Promise((r) => server.listen(PORT, r));

// ---------------------------------------------------------------- Browser
const b = await pw.chromium.launch(START);

/** Kontext mit angemeldetem Nutzer und abgefangenem Supabase. */
async function kontext({ rolle, sw = 'block', testSicht = null, offlineForm = null }) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: sw });
  await ctx.addInitScript(([uid, sicht]) => {
    localStorage.setItem('maja-logistik-auth', JSON.stringify({
      access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } }));
    if (sicht) localStorage.setItem('maja:test-mode:effective-role', sicht);
  }, [UID, testSicht]);
  const log = { schreibend: [] };
  await ctx.route('https://stub.supabase.co/**', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    if (m !== 'GET' && m !== 'HEAD' && !p.startsWith('/auth/')) log.schreibend.push({ m, p, body: req.postData() });
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
    if (p.startsWith('/auth/') || p.startsWith('/realtime/')) return json({});
    if (p === '/rest/v1/app_users') {
      const a = { id: UID, role: rolle, email: 'a@m.de', vorname: 'Erika', nachname: 'Muster', aktiv: true, auftraggeber_id: rolle === 'auftraggeber' ? 'ag1' : null };
      return json(obj ? a : [a]);
    }
    if (p === '/rest/v1/fahrer') {
      const fa = [{ id: 'f1', user_id: UID, aktiv: true, vorname: 'Kemal', nachname: 'Y', ist_unterkonto: false, haupt_user_id: null, user: null }];
      return json(obj ? fa[0] : fa);
    }
    if (offlineForm && p === '/rest/v1/ausgefuellte_formulare' && m === 'GET' && u.searchParams.get('id') === 'eq.af1') return json(offlineForm.formular);
    if (offlineForm && p === '/rest/v1/formular_templates' && m === 'GET') return json(offlineForm.template);
    if (p.startsWith('/storage/')) return r.fulfill({ status: 404, body: '' });
    return json(obj ? null : []);
  });
  return { ctx, log };
}

async function seiteOk(pg, url, fehlerListe) {
  await pg.goto(BASIS + url);
  await pg.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(400);
  const text = await pg.locator('#root').innerText().catch(() => '');
  const karte = await pg.getByTestId('neue-version-karte').count();
  const kaputt = /Etwas ist schiefgelaufen/.test(text);
  const ok = text.trim().length > 20 && !karte && !kaputt && !fehlerListe.some((e) => /dynamically imported|Importing a module/i.test(e));
  return { ok, text: text.slice(0, 120), karte, kaputt };
}

// ---- 1) Rundgang: alle Seiten je Rolle (Produktions-Build, Version A)
const ROUTEN = {
  admin: ['/touren', '/meine-formulare', '/greimel-zugaenge', '/eingaenge', '/posteingang', '/belege', '/aufstellung', '/rechnungen',
    '/rechnungen/neu', '/gutschriften', '/gutschriften/neu', '/briefe', '/briefe/neu', '/tankkarten', '/templates',
    '/einstellungen/auftraggeber', '/einstellungen/preislisten', '/einstellungen/fahrer', '/einstellungen/postfaecher',
    '/einstellungen/vorschlaege', '/einstellungen/gutschriften', '/einstellungen/manuelle-empfaenger', '/einstellungen/brief-vorlagen',
    '/einstellungen/auftrags-email', '/einstellungen/firmendaten', '/einstellungen/erechnung-export', '/einstellungen/erechnung-test',
    '/einstellungen/diagnose', '/profil', '/recovery', '/fuehrerschein', '/meine-unterkonten'],
  fahrer: ['/touren', '/meine-formulare', '/briefe', '/greimel-zugaenge', '/eingaenge', '/profil', '/meine-unterkonten'],
  auftraggeber: ['/touren', '/formulare', '/profil'],
};
const LAEUFE = [
  ['Admin', 'admin', null, ROUTEN.admin], ['Fahrer', 'fahrer', null, ROUTEN.fahrer], ['Auftraggeber', 'auftraggeber', null, ROUTEN.auftraggeber],
  ['Test-Account (Sicht Fahrer)', 'test', 'fahrer', ROUTEN.fahrer], ['Test-Account (Sicht Auftraggeber)', 'test', 'auftraggeber', ROUTEN.auftraggeber],
];
console.log('\n1) Alle Seiten je Rolle (Produktions-Build)');
for (const [name, rolle, sicht, routen] of LAEUFE) {
  const { ctx } = await kontext({ rolle, testSicht: sicht });
  const pg = await ctx.newPage();
  const fehlerListe = [];
  pg.on('pageerror', (e) => fehlerListe.push(e.message));
  const schlecht = [];
  for (const r of routen) { const e = await seiteOk(pg, r, fehlerListe); if (!e.ok) schlecht.push({ r, ...e }); }
  pr(`${name}: ${routen.length} Seiten laden`, schlecht.length === 0 && fehlerListe.length === 0, { schlecht, fehlerListe });
  await ctx.close();
}

// Fahrer: Admin-Bibliotheken werden nicht geladen
{
  aktiv = 'a';
  const { ctx } = await kontext({ rolle: 'fahrer' });
  const pg = await ctx.newPage();
  const geladen = [];
  pg.on('request', (q) => { const p = new URL(q.url()).pathname; if (p.startsWith('/assets/')) geladen.push(p.slice(8)); });
  for (const r of ROUTEN.fahrer) await seiteOk(pg, r, []);
  const verboten = geladen.filter((f) => /^(xlsx|pdf|fontkit|heic2any|Rechnung|Gutschrift|Posteingang|TemplateEditor|Belege|erstellen)/.test(f));
  pr('Fahrer lädt beim Rundgang weder xlsx, pdf.js, fontkit noch Admin-Seiten', verboten.length === 0, verboten);
  const haupt = readdirSync(join(AUS, 'a', 'assets')).filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(join(AUS, 'a', 'assets', f)).size);
  console.log(`  info  Haupt-Chunk: ${Math.round(haupt[0] / 1024)} KB`);
  await ctx.close();
}

// ---- 2) Versionswechsel ohne Service Worker: nachgeladener Teil fehlt → einmal neu laden
console.log('\n2) Versionswechsel (alte Version offen, neue deployed)');
{
  aktiv = 'a';
  const { ctx } = await kontext({ rolle: 'admin' });
  const pg = await ctx.newPage();
  let ladungen = 0;
  pg.on('load', () => { ladungen++; });
  await pg.goto(`${BASIS}/touren`);
  await pg.waitForLoadState('networkidle').catch(() => {});
  aktiv = 'b'; // Deploy: alte Dateien weg
  const vorher = ladungen;
  await pg.evaluate(() => { window.history.pushState({}, '', '/rechnungen'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await pg.waitForFunction(() => document.querySelectorAll('script[src*="/assets/b-"]').length > 0, null, { timeout: 15000 }).catch(() => {});
  await pg.waitForLoadState('networkidle').catch(() => {});
  await pg.waitForTimeout(800);
  const text = await pg.locator('#root').innerText();
  pr('Fehlender Programmteil → genau EIN automatisches Neuladen, dann neue Version', ladungen - vorher === 1 && (await pg.locator('script[src*="/assets/b-"]').count()) > 0, { neuGeladen: ladungen - vorher });
  pr('Kein weißer Bildschirm: Rechnungen-Seite der neuen Version sichtbar', /Rechnungen/.test(text) && !(await pg.getByTestId('neue-version-karte').count()), text.slice(0, 200));
  await ctx.close();
}
{
  // Schleifenschutz: auch die neue Version ist (simuliert) unvollständig
  aktiv = 'a';
  const { ctx } = await kontext({ rolle: 'admin' });
  const pg = await ctx.newPage();
  let ladungen = 0;
  pg.on('load', () => { ladungen++; });
  await pg.goto(`${BASIS}/touren`);
  await pg.waitForLoadState('networkidle').catch(() => {});
  aktiv = 'b-kaputt';
  const vorher = ladungen;
  await pg.evaluate(() => { window.history.pushState({}, '', '/rechnungen'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await pg.getByTestId('neue-version-karte').waitFor({ timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(3000);
  pr('Schleifenschutz: höchstens EIN Neuladen, danach Hinweis-Karte statt Endlosschleife',
    ladungen - vorher <= 1 && (await pg.getByTestId('neue-version-karte').count()) === 1, { neuGeladen: ladungen - vorher });
  await pg.screenshot({ path: join(AUS, 'neue-version-karte.png') });
  await ctx.close();
}

// ---- 3) Mit Service Worker: alte Version offen, Deploy → nachgeladene Teile kommen aus dem Cache
console.log('\n3) Service Worker');
{
  aktiv = 'a';
  const { ctx } = await kontext({ rolle: 'admin', sw: 'allow' });
  const pg = await ctx.newPage();
  await pg.goto(`${BASIS}/touren`);
  await pg.evaluate(async () => { await navigator.serviceWorker.ready; });
  await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  if (!(await pg.evaluate(() => !!navigator.serviceWorker.controller))) { await pg.reload(); await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }); }
  const imCache = await pg.evaluate(async () => {
    const namen = await caches.keys(); const urls = [];
    for (const n of namen) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  const lazyTeile = readdirSync(join(AUS, 'a', 'assets')).filter((f) => /^(RechnungDetailPage|xlsx|pdf)-.*\.js$/.test(f));
  pr('Service Worker hält nachgeladene Teile vor (Rechnung, xlsx, pdf.js)', lazyTeile.length === 3 && lazyTeile.every((f) => imCache.some((u) => u.endsWith(f))), { lazyTeile, anzahlImCache: imCache.length });
  aktiv = 'b';
  const fehlerListe = []; pg.on('pageerror', (e) => fehlerListe.push(e.message));
  await pg.evaluate(() => { window.history.pushState({}, '', '/rechnungen'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await pg.waitForTimeout(1500);
  const text = await pg.locator('#root').innerText();
  pr('Nach Deploy: Admin-Seite der alten Version kommt aus dem Cache (kein Fehler)', /Rechnungen/.test(text) && !(await pg.getByTestId('neue-version-karte').count()) && fehlerListe.length === 0, { text: text.slice(0, 120), fehlerListe });
  // Update-Prüfung (stündlich in der App): neue Version übernimmt, Seite lädt neu
  await pg.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
  await pg.waitForFunction(() => document.querySelectorAll('script[src*="/assets/b-"]').length > 0, null, { timeout: 30000 }).catch(() => {});
  await pg.waitForLoadState('networkidle').catch(() => {});
  pr('Update-Prüfung: neue Version übernimmt ohne weißen Bildschirm', (await pg.locator('script[src*="/assets/b-"]').count()) > 0 && (await pg.locator('#root').innerText()).trim().length > 20);
  await ctx.close();
}

// ---- 4) Fahrer: Formular offline ausfüllen, wieder online → Abgleich
console.log('\n4) Fahrer-Formular offline');
{
  aktiv = 'b';
  const formular = { id: 'af1', template_id: 'tpl1', fahrer_id: 'f1', tour_id: null, status: 'draft', daten: {}, daten_geaendert_am: null,
    created_at: '2026-11-10T08:00:00Z', updated_at: '2026-11-10T08:00:00Z', eingereicht_am: null, pdf_url: null, uebertragen_auf_id: null, bearbeiter_version: 1 };
  const template = { id: 'tpl1', name: 'Übergabeprotokoll (Test)', schema: { sections: [{ id: 's1', title: 'Fahrzeug', fields: [
    { id: 'km', type: 'text', label: 'Kilometerstand' }, { id: 'bem', type: 'textarea', label: 'Bemerkung' }] }] },
    pdfs: [], email_config: null, aktiv: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  const { ctx, log } = await kontext({ rolle: 'fahrer', sw: 'allow', offlineForm: { formular, template } });
  const pg = await ctx.newPage();
  const fehlerListe = []; pg.on('pageerror', (e) => fehlerListe.push(e.message));
  await pg.goto(`${BASIS}/meine-formulare`);
  await pg.evaluate(async () => { await navigator.serviceWorker.ready; });
  await pg.reload(); await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await pg.goto(`${BASIS}/formular/af1`);
  const km = pg.getByLabel('Kilometerstand');
  await km.waitFor({ timeout: 20000 });
  await ctx.setOffline(true);
  const schreibVorher = log.schreibend.length;
  await km.fill('123456');
  await pg.getByLabel('Bemerkung').fill('Offline eingetragen — Kratzer hinten links');
  await pg.waitForTimeout(2500);
  const lokal = await pg.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open('maja-logistik-db');
    req.onerror = () => ok({ fehler: 'db' });
    req.onsuccess = () => {
      const db = req.result; const namen = [...db.objectStoreNames];
      const store = namen.find((n) => /draft/i.test(n));
      if (!store) { ok({ namen }); return; }
      const g = db.transaction(store).objectStore(store).getAll();
      g.onsuccess = () => ok({ store, eintraege: g.result.map((e) => JSON.stringify(e).slice(0, 300)) });
    };
  }));
  pr('Offline: Eingaben lokal gesichert (IndexedDB), nichts an den Server', JSON.stringify(lokal).includes('123456') && log.schreibend.length === schreibVorher, { lokal, schreibend: log.schreibend.length - schreibVorher });
  // offline zu einer anderen Fahrer-Seite und zurück (App-Shell aus dem Cache)
  await pg.goto(`${BASIS}/meine-formulare`).catch(() => {});
  const offlineText = await pg.locator('#root').innerText().catch(() => '');
  pr('Offline: App lädt aus dem Service-Worker-Cache', offlineText.trim().length > 20 && !(await pg.getByTestId('neue-version-karte').count()), offlineText.slice(0, 120));
  await pg.goBack().catch(() => {});
  await ctx.setOffline(false);
  await pg.evaluate(() => window.dispatchEvent(new Event('online')));
  await pg.waitForTimeout(6000);
  const gesendet = log.schreibend.slice(schreibVorher).filter((x) => (x.body ?? '').includes('123456'));
  pr('Wieder online: Entwurf mit den Offline-Eingaben an den Server abgeglichen', gesendet.length > 0, log.schreibend.slice(schreibVorher).map((x) => `${x.m} ${x.p}`));
  pr('Keine Fehler im Fahrer-Ablauf', fehlerListe.length === 0, fehlerListe);
  await pg.screenshot({ path: join(AUS, 'fahrer-formular.png') });
  await ctx.close();
}

await b.close();
server.close();
console.log(fehler ? `\n${fehler} FEHLER` : '\nProduktions-Build: alle Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
