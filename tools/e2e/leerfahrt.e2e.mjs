import { pw, START, BASIS } from './basis.mjs';
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const ROLLE = process.argv[4] ?? 'admin'; const MOBIL = process.argv[5] === 'mobil';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i)); } };
const AG = 'ag1';
let zn = 0;
const Z = (tour, kategorie, kennzeichen, betrag = 25, herkunft = null) => ({ id: `z${++zn}`, tour_id: tour, kategorie, anzahl: 1, betrag, notiz: null, kennzeichen, herkunft, created_at: '2026-11-01T10:00:00Z', dauer_min: null, preis_quelle: null });
const tour = (id, nr, art, kz) => ({
  id, tour_id: nr, start_stadt: 'Bremen', ziel_stadt: 'Hamburg', rueckfuehrung_stadt: art === 'AB' ? null : 'Bremen', kundenname: null, auftraggeber_id: AG, fahrer_id: 'f1', status: 'geplant',
  startdatum: '2026-11-03', enddatum: '2026-11-03', tourenart: art, kennzeichen: kz, protokoll_art: 'app', schriftliches_protokoll_id: null, greimel_zugang_id: null,
  ist_e_fahrzeug: false, fin: null, eingang_id: null, eingang_id_bc: null, km_gesamt: 100, km_hin: 100, km_rueck: null, bearbeitet_markiert_am: null, bestaetigt: true,
  erstellt_von_rolle: 'admin', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', abgelehnt: false, zurueckgestellt: false, zeit_start: null, zeit_ziel: null,
  auf_eis: false, auf_eis_notiz: null, verguetung: 120, barauslagen: 0, fahrer_honorar: 0, ist_sondervereinbarung: false, sondervereinbarung: null, info: null,
  rechnungsdatum_abweichend: false, rechnungsdatum: null, fin_rueck: null,
  auftraggeber: { id: AG, name: 'Arval', kontakt: null, externe_app_name: null, externe_app_url: null },
  fahrer: null, schriftliches_protokoll: null, protokoll_zuweisungen: [], eingang: null, kontakt: null,
});
const touren = [tour('L1', 'T-2026-0401', 'AB', ['HB-AB 1']), tour('L2', 'T-2026-0402', 'ABA', ['HB-HI 1', 'HH-AB 1234']), tour('L3', 'T-2026-0403', 'AB', ['HB-N 3'])];
let zusaetze = [Z('L2', 'Tankauslagen', 'HB-HI 1', 40), Z('L1', 'Keine Auslagen', 'HB-AB 1', 0, null)];
zusaetze = zusaetze.filter((z) => z.tour_id !== 'L1');   // L1 startet ohne Zusätze
let leer = new Map();
const log = { rpc: [], posts: [], leerReads: 0 };
const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL });
await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
  access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const p = u.pathname; const sp = u.searchParams; const m = req.method();
  const eqW = (k) => { const v = sp.getAll(k).find((x) => x.startsWith('eq.')) ?? ''; return v.slice(3); };
  const inL = (k) => { const v = sp.getAll(k).find((x) => x.startsWith('in.')) ?? ''; const mm = v.match(/^in\.\((.*)\)$/); return mm ? mm[1].split(',').map((x) => x.replace(/"/g, '')) : null; };
  const page = (l) => { const o = Number(sp.get('offset') ?? 0); return sp.has('offset') || sp.has('limit') ? l.slice(o, o + Number(sp.get('limit') ?? 1000)) : l; };
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: ROLLE, email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: ROLLE === 'auftraggeber' ? AG : null }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/fahrer') { const fa = [{ id: 'f1', user_id: UID, aktiv: true, vorname: 'Kemal', nachname: 'Y', ist_unterkonto: false, haupt_user_id: null, user: null }]; return json(obj ? fa[0] : fa); }
  if (p === '/rest/v1/zusatz_arten') return json([['maut', false], ['keineauslagen', false]].map(([s, a]) => ({ schluessel: s, zaehlt_als_auslage: a })));
  if (p === '/rest/v1/auftraggeber') { const a = [{ id: AG, name: 'Arval', rechnungsformat: null }]; return json(obj ? a[0] : a); }
  if (p === '/rest/v1/tour_leerfahrt') {
    log.leerReads++;
    if (ROLLE !== 'admin') return json([]);
    const ids = inL('tour_id'); const l = [...leer.entries()].filter(([id]) => !ids || ids.includes(id)).map(([id, v]) => ({ tour_id: id, ...v }));
    return json(l);
  }
  if (p === '/rest/v1/rpc/tour_leerfahrt_setzen') {
    const body = JSON.parse(req.postData()); log.rpc.push(body);
    if (body.p_an) { leer.set(body.p_tour_id, { gesetzt_am: '2026-11-05T09:00:00Z', gesetzt_von_name: 'Ad Min' }); return json({ geaendert: true }); }
    leer.delete(body.p_tour_id);
    const weg = zusaetze.filter((z) => z.tour_id === body.p_tour_id && z.herkunft === 'leerfahrt').length;
    zusaetze = zusaetze.filter((z) => !(z.tour_id === body.p_tour_id && z.herkunft === 'leerfahrt'));
    return json({ geaendert: true, entfernt: weg });
  }
  if (p === '/rest/v1/tour_zusaetze') {
    if (m === 'POST') { const body = JSON.parse(req.postData()); const rows = Array.isArray(body) ? body : [body]; log.posts.push(...rows); const neu = rows.map((x) => ({ ...Z(x.tour_id, x.kategorie, x.kennzeichen ?? null, x.betrag, x.herkunft ?? null) })); zusaetze.push(...neu); return json(obj ? neu[0] : neu, 201); }
    return json(zusaetze.filter((z) => !eqW('tour_id') || z.tour_id === eqW('tour_id')));
  }
  if (p === '/rest/v1/rechnungspositionen' || p === '/rest/v1/rechnungen') return json(obj ? null : page([]));
  if (p === '/rest/v1/touren_kundensicht') return json(page(touren.map((t) => ({ id: t.id, tour_id: t.tour_id, start_stadt: t.start_stadt, ziel_stadt: t.ziel_stadt, startdatum: t.startdatum, enddatum: t.enddatum, kennzeichen: t.kennzeichen, tourenart: t.tourenart, status: 'geplant', bestaetigt: true }))));
  if (p === '/rest/v1/touren') {
    const sel = sp.get('select') ?? '';
    if (sel === 'id' || sel.startsWith('kontakt')) return json([]);
    let l = touren.map((t) => ({ ...t, zusaetze: zusaetze.filter((z) => z.tour_id === t.id) }));
    const ids = inL('id'); if (ids) l = l.filter((t) => ids.includes(t.id));
    const eq = eqW('id'); if (eq) l = l.filter((t) => t.id === eq);
    return obj ? json(l[0] ?? null) : json(page(l));
  }
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('pageerror', e.message));
const B = BASIS;
const card = (nr) => pg.locator('li').filter({ hasText: nr }).first();

await pg.goto(`${B}/touren`);
await pg.getByText('T-2026-0401').first().waitFor({ timeout: 15000 });
await pg.waitForTimeout(800);

if (ROLLE !== 'admin') {
  pr(`${ROLLE}: keine Leerfahrt-Anzeige, kein Laden der Markierung`, (await pg.locator('[data-leerfahrt], [data-wasserzeichen]').count()) === 0 && (await pg.getByText(/Leerfahrt/i).count()) === 0, [await pg.locator('[data-leerfahrt]').count(), log.leerReads]);
  await b.close(); console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0);
}

// Höhe vorher
const hoeheVorher = await card('T-2026-0401').locator('button.card').evaluate((e) => e.offsetHeight);
// L1: Leerfahrt setzen (Schnellaktion)
await card('T-2026-0401').locator('[data-leerfahrt="nein"]').click();
await card('T-2026-0401').locator('[data-wasserzeichen]').waitFor({ timeout: 8000 });
pr('L1: RPC gesetzt + „Keine Auslagen" (herkunft leerfahrt) für HB-AB 1', log.rpc.at(-1)?.p_an === true && log.posts.some((x) => x.tour_id === 'L1' && x.kategorie === 'Keine Auslagen' && x.kennzeichen === 'HB-AB 1' && x.herkunft === 'leerfahrt'), log.posts);
pr('L1: Badge „Leerfahrt" gesetzt (aria-pressed)', (await card('T-2026-0401').locator('[data-leerfahrt="ja"]').getAttribute('aria-pressed')) === 'true');
await card('T-2026-0401').locator('[data-auslagen="keine"]').waitFor({ timeout: 8000 }).catch(() => {});
pr('L1: Auslagen danach geklärt (Badge „Keine Auslagen")', (await card('T-2026-0401').locator('[data-auslagen]').allInnerTexts()).join('|').toLowerCase().includes('keine auslagen'));
const [mitWz, ohneWz] = await card('T-2026-0401').locator('button.card').evaluate((e) => {
  const mit = e.offsetHeight; const w = e.querySelector('[data-wasserzeichen]'); w.style.display = 'none';
  const ohne = e.offsetHeight; w.style.display = ''; return [mit, ohne];
});
pr('Kartenhöhe durch Wasserzeichen unverändert', mitWz === ohneWz, [hoeheVorher, mitWz, ohneWz]);
const wz = card('T-2026-0401').locator('[data-wasserzeichen]');
const stil = await wz.evaluate((e) => { const c = getComputedStyle(e); const t = getComputedStyle(e.firstElementChild); return { pe: c.pointerEvents, color: t.color, transform: t.transform }; });
pr('Wasserzeichen: pointer-events none, gedreht, niedrige Deckkraft', stil.pe === 'none' && stil.transform !== 'none' && /, 0\.1\)$/.test(stil.color), stil);
const ueberlauf = await card('T-2026-0401').locator('button.card').evaluate((e) => getComputedStyle(e).overflow);
pr('Karte schneidet Wasserzeichen ab (overflow hidden)', ueberlauf === 'hidden', ueberlauf);
// Klickbarkeit: Punkt mitten auf dem Wasserzeichen trifft die Karte, nicht das Wasserzeichen
const bb = await wz.boundingBox();
const getroffen = await pg.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !el?.closest('[data-wasserzeichen]') && !!el?.closest('button.card'); }, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
pr('Mitte des Wasserzeichens: Klick geht an die Karte', getroffen);
await pg.screenshot({ path: `${OUT}/lf_liste_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: !MOBIL });
// L2: ABA, Hin hat Tank → nur Rück
await card('T-2026-0402').locator('[data-leerfahrt="nein"]').click();
await card('T-2026-0402').locator('[data-wasserzeichen]').waitFor({ timeout: 8000 });
const l2 = log.posts.filter((x) => x.tour_id === 'L2');
pr('L2 (ABA, Hin mit Tank): nur Rück HH-AB 1234 erhält „Keine Auslagen"', l2.length === 1 && l2[0].kennzeichen === 'HH-AB 1234' && l2[0].herkunft === 'leerfahrt', l2);
// Filter
await pg.getByRole('button', { name: /^Leerfahrten \(2\)/ }).click();
await pg.waitForTimeout(300);
const sichtbar = await pg.locator('li').filter({ hasText: /T-2026-04\d\d/ }).allInnerTexts();
pr('Filter „Leerfahrten": nur L1 + L2', !sichtbar.some((x) => x.includes('T-2026-0403')) && sichtbar.some((x) => x.includes('T-2026-0401')), sichtbar.map((x) => x.slice(0, 11)));
await pg.getByRole('button', { name: /^Leerfahrten/ }).click();
if (MOBIL) { await b.close(); console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0); }
// Manuelles „Keine Auslagen" an L1 (ohne Herkunft) — bleibt beim Entfernen
zusaetze.push(Z('L1', 'Keine Auslagen', null, 0, null));
// Entfernen über Badge → Rückfrage
await card('T-2026-0401').locator('[data-leerfahrt="ja"]').click();
const frage = pg.getByText('Leerfahrt entfernen? Die automatisch gesetzten „Keine Auslagen" werden ebenfalls entfernt.');
await frage.waitFor({ timeout: 5000 });
pr('Entfernen: Rückfrage erscheint, noch nichts entfernt', log.rpc.filter((x) => !x.p_an).length === 0);
await pg.getByRole('button', { name: 'Leerfahrt entfernen' }).click();
await card('T-2026-0401').locator('[data-wasserzeichen]').waitFor({ state: 'detached', timeout: 8000 });
pr('Entfernt: nur automatischer Eintrag weg, manueller bleibt', zusaetze.filter((z) => z.tour_id === 'L1').map((z) => z.herkunft ?? 'manuell').join() === 'manuell');
// Klick auf Karte öffnet Detail (trotz Wasserzeichen bei L2)
await card('T-2026-0402').locator('button.card').click({ position: { x: 300, y: 60 } });
await pg.getByTestId('leerfahrt-leiste').waitFor({ timeout: 10000 });
pr('Klick auf Karte mit Wasserzeichen öffnet Tour-Detail; Hinweisbalken „Leerfahrt"', (await pg.getByTestId('leerfahrt-leiste').innerText()).includes('LEERFAHRT'));
await pg.screenshot({ path: `${OUT}/lf_detail_${THEME}.png` });
// Detail: entfernen + wieder setzen
await pg.getByTestId('leerfahrt-leiste').getByRole('button', { name: 'Leerfahrt entfernen' }).click();
await pg.getByRole('button', { name: 'Leerfahrt entfernen' }).last().click();
await pg.getByRole('button', { name: 'Leerfahrt', exact: true }).waitFor({ timeout: 8000 });
pr('Detail: entfernt (Umschalter wieder „Leerfahrt")', !leer.has('L2'));
await b.close();
console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0);
