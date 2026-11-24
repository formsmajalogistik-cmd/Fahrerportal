// „Änderungen durch Auftraggeber" nur bei bestätigten Aufträgen und
// Bestätigen mit Versionsprüfung (Migration 119).
//
//   Variante „mit" (Standard): Anzeige/Zähler kommen aus der View
//     tour_aenderungen_offen (der Server liefert dort nur bestätigte Touren);
//     Bestätigen geht über tour_bestaetigen(p_tour_id, p_stand). Ändert der
//     Auftraggeber zwischen Laden und Bestätigen, wird angehalten, der
//     Hinweis nennt die Felder, die Daten werden neu geladen — in der Liste
//     und im Tour-Detail.
//   Variante „ohne": Migration 119 fehlt → Verhalten wie bisher (Tabelle,
//     direktes Setzen von bestaetigt).
//
// Argumente: <Ausgabeordner> <light|dark> [mit|ohne]
import { pw, START, BASIS } from './basis.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const MIT = (process.argv[4] ?? 'mit') === 'mit';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 800)); } };
const tagIn = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const AG = { id: 'ag1', name: 'Arval Deutschland GmbH', kontakt: null, externe_app_name: null, externe_app_url: null };
const tour = (id, nr, start, ziel, bestaetigt, stand) => ({
  id, tour_id: nr, start_stadt: start, ziel_stadt: ziel, rueckfuehrung_stadt: null, kundenname: 'Kunde', auftraggeber_id: 'ag1', fahrer_id: null,
  status: 'geplant', startdatum: tagIn(3), enddatum: tagIn(3), tourenart: 'AB', kennzeichen: ['HB-X 1'], protokoll_art: null,
  schriftliches_protokoll_id: null, greimel_zugang_id: null, ist_e_fahrzeug: false, fin: null, eingang_id: null, eingang_id_bc: null,
  km_gesamt: null, bearbeitet_markiert_am: null, bestaetigt, erstellt_von_rolle: 'auftraggeber', created_at: `${tagIn(-3)}T08:00:00Z`,
  updated_at: stand, abgelehnt: false, zurueckgestellt: false, zeit_start: null, zeit_ziel: null, auf_eis: false, auf_eis_notiz: null,
  verguetung: null, barauslagen: null, fahrer_honorar: null, ist_sondervereinbarung: false, rechnungsdatum_abweichend: false, rechnungsdatum: null,
  info: 'alt', auftraggeber: AG, fahrer: null, schriftliches_protokoll: null, protokoll_zuweisungen: [], zusaetze: [], eingang: null,
});
const STAND1 = '2026-11-20T10:00:00.123456+00:00';
const STAND2 = '2026-11-20T10:05:00.654321+00:00';
const TOUREN = [
  tour('tu', 'T-2026-0501', 'Bremen', 'Hamburg', false, STAND1),   // Einreichung, wird in der Liste bestätigt
  tour('td', 'T-2026-0502', 'Verden', 'Celle', false, STAND1),     // Einreichung, wird im Tour-Detail bestätigt
  tour('tb', 'T-2026-0503', 'Stuhr', 'Kiel', true, STAND1),        // bestätigt
];
// Offene Einträge: an der bestätigten UND an einer unbestätigten Tour.
const EINTRAEGE = [
  { id: 'a1', tour_id: 'tb', geaendert_von: 'agu', geaendert_am: '2026-11-20T09:00:00Z', feld: 'info', wert_alt: 'alt', wert_neu: 'Schlüssel beim Pförtner', gesehen_am: null, gesehen_von: null, quelle: 'auftraggeber', vor_bestaetigung: false },
  { id: 'a2', tour_id: 'tu', geaendert_von: 'agu', geaendert_am: '2026-11-20T09:30:00Z', feld: 'info', wert_alt: 'alt', wert_neu: 'neue Rampe', gesehen_am: null, gesehen_von: null, quelle: 'auftraggeber', vor_bestaetigung: true },
];
const offenAnzeige = () => EINTRAEGE.filter((e) => !e.gesehen_am && !e.vor_bestaetigung && TOUREN.find((t) => t.id === e.tour_id)?.bestaetigt);

const log = { rpc: [], quellen: [], patches: [] };
// Simuliert: Der Auftraggeber ändert die Tour, nachdem der Admin geladen hat.
const agAendert = (id, feld, neu) => {
  const t = TOUREN.find((x) => x.id === id);
  const alt = t[feld]; t[feld] = neu; t.updated_at = STAND2;
  return { feld, alt, neu, am: '2026-11-20T10:05:00Z' };
};
let ausstehend = {}; // tour_id → Änderung, die beim nächsten Bestätigen „dazwischenkommt"

const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
await ctx.addInitScript(([uid, theme]) => {
  localStorage.setItem('maja-theme', theme);
  localStorage.setItem('maja-logistik-auth', JSON.stringify({ access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } }));
}, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const p = u.pathname; const sp = u.searchParams; const m = req.method();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const json = (x, status = 200, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(x) });
  const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } };
  const fehlt = () => json({ code: 'PGRST205', message: 'Could not find the table in the schema cache', details: null, hint: null }, 404);
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/auftraggeber') return json(obj ? AG : [AG]);
  if (p === '/rest/v1/rpc/tour_bestaetigen') {
    const a = body(); log.rpc.push(a);
    if (!MIT) return json({ code: 'PGRST202', message: 'Could not find the function public.tour_bestaetigen', details: null, hint: null }, 404);
    const t = TOUREN.find((x) => x.id === a.p_tour_id);
    if (ausstehend[a.p_tour_id]) { const g = ausstehend[a.p_tour_id](); delete ausstehend[a.p_tour_id]; return json({ ok: false, grund: 'geaendert', aenderungen: [g], stand: t.updated_at }); }
    if (a.p_stand !== t.updated_at) return json({ ok: false, grund: 'geaendert', aenderungen: [], stand: t.updated_at });
    t.bestaetigt = true; return json({ ok: true });
  }
  if (p === '/rest/v1/tour_aenderungen_offen' || p === '/rest/v1/tour_aenderungen') {
    log.quellen.push(`${m} ${p.slice(9)}`);
    if (p.endsWith('_offen') && !MIT) return fehlt();
    if (p.endsWith('_offen')) {
      const l = offenAnzeige();
      return m === 'HEAD' ? r.fulfill({ status: 200, headers: { 'content-range': `*/${l.length}` }, body: '' }) : json(l);
    }
    if (m === 'PATCH') { log.patches.push({ p, body: body() }); return json([]); }
    const tid = (sp.get('tour_id') ?? '').slice(3);
    const l = EINTRAEGE.filter((e) => (sp.get('gesehen_am') === 'is.null' ? !e.gesehen_am : true) && (!tid || e.tour_id === tid));
    return m === 'HEAD' ? r.fulfill({ status: 200, headers: { 'content-range': `*/${l.length}` }, body: '' }) : json(l);
  }
  if (p === '/rest/v1/touren') {
    if (m === 'PATCH') {
      const id = (sp.get('id') ?? '').slice(3); const x = body(); log.patches.push({ p, id, body: x });
      Object.assign(TOUREN.find((t) => t.id === id) ?? {}, x); return json([]);
    }
    if (m === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': `*/${TOUREN.filter((t) => !t.bestaetigt).length}` }, body: '' });
    let l = TOUREN;
    const id = (sp.get('id') ?? '');
    if (id.startsWith('eq.')) l = l.filter((t) => t.id === id.slice(3));
    if (id.startsWith('in.(')) { const ids = id.slice(4, -1).split(','); l = l.filter((t) => ids.includes(t.id)); }
    if (sp.get('bestaetigt') === 'eq.false') l = l.filter((t) => !t.bestaetigt);
    if (sp.get('auf_eis') === 'eq.true') l = l.filter((t) => t.auf_eis);
    if (obj) return json(l[0] ?? null);
    const o = Number(sp.get('offset') ?? 0);
    return json(sp.has('limit') ? l.slice(o, o + Number(sp.get('limit'))) : l);
  }
  if (m === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
const fehler = []; pg.on('pageerror', (e) => fehler.push(e.message));
await pg.goto(`${BASIS}/touren`);
await pg.getByText('Zur Bestätigung').first().waitFor({ timeout: 20000 });
await pg.waitForTimeout(800);

// ---- 1) Anzeige „Änderungen durch Auftraggeber"
const bereich = pg.locator('section', { hasText: 'Änderungen durch Auftraggeber' });
const bereichText = (await bereich.count()) ? await bereich.innerText() : '';
if (MIT) {
  pr('Anzeige: nur die bestätigte Tour (T-2026-0503), nicht die unbestätigte Einreichung (T-2026-0501)',
    bereichText.includes('T-2026-0503') && !bereichText.includes('T-2026-0501') && /Änderungen durch Auftraggeber \(1\)/.test(bereichText), bereichText.slice(0, 300));
  pr('Anzeige und Zähler lesen die View tour_aenderungen_offen (nicht die Tabelle)',
    log.quellen.some((q) => q === 'GET tour_aenderungen_offen') && log.quellen.some((q) => q === 'HEAD tour_aenderungen_offen')
      && !log.quellen.some((q) => /^(GET|HEAD) tour_aenderungen$/.test(q)), log.quellen);
} else {
  pr('Ohne Migration 119: Anzeige wie bisher (Tabelle, auch unbestätigte Einreichung)',
    bereichText.includes('T-2026-0503') && bereichText.includes('T-2026-0501') && log.quellen.some((q) => q === 'GET tour_aenderungen'), { bereichText: bereichText.slice(0, 200), quellen: log.quellen });
}

// ---- 2) Bestätigen in der Liste — Auftraggeber ändert dazwischen
const karte = (nr) => pg.locator('section', { hasText: 'Zur Bestätigung' }).locator('li, article, div.rounded-lg').filter({ hasText: nr }).filter({ has: pg.getByRole('button', { name: 'Tour bestätigen' }) }).last();
if (MIT) {
  ausstehend.tu = () => agAendert('tu', 'info', 'Tor 3 statt Tor 1');
  await karte('T-2026-0501').getByRole('button', { name: 'Tour bestätigen' }).click();
  const hinweis = pg.getByTestId('bestaetigen-geaendert');
  await hinweis.waitFor({ timeout: 10000 });
  const h = await hinweis.innerText();
  pr('Liste: Bestätigen angehalten — Hinweis „soeben geändert" mit Feld (Hinweise: alt → Tor 3 statt Tor 1)',
    /soeben geändert/.test(h) && h.includes('Hinweise') && h.includes('Tor 3 statt Tor 1') && log.rpc[0]?.p_stand === STAND1 && !TOUREN[0].bestaetigt, { h, rpc: log.rpc[0] });
  await pg.screenshot({ path: `${OUT}/liste_hinweis_${THEME}.png`, fullPage: true });
  await pg.waitForTimeout(600);
  await karte('T-2026-0501').getByRole('button', { name: 'Tour bestätigen' }).click();
  for (let i = 0; i < 40 && !TOUREN[0].bestaetigt; i++) await pg.waitForTimeout(100);
  pr('Liste: nach dem Neuladen wird der neue Stand bestätigt', TOUREN[0].bestaetigt && log.rpc[1]?.p_stand === STAND2, log.rpc);
} else {
  await karte('T-2026-0501').getByRole('button', { name: 'Tour bestätigen' }).click();
  for (let i = 0; i < 40 && !TOUREN[0].bestaetigt; i++) await pg.waitForTimeout(100);
  pr('Ohne Migration 119: Bestätigen wie bisher (bestaetigt direkt gesetzt)', TOUREN[0].bestaetigt && log.patches.some((x) => x.id === 'tu' && x.body?.bestaetigt === true), log.patches);
}

// ---- 3) Bestätigen im Tour-Detail
if (MIT) {
  await pg.waitForTimeout(600);
  await pg.locator('section', { hasText: 'Zur Bestätigung' }).getByText('T-2026-0502').first().click();
  // Tour-Detail-Modal (Container ohne dialog-Rolle).
  const dlg = pg.locator('div.fixed.inset-0 > div.card.max-w-5xl').filter({ has: pg.getByRole('button', { name: 'Bearbeiten' }) }).last();
  const knopf = dlg.getByRole('button', { name: 'Tour bestätigen' });
  await knopf.waitFor({ timeout: 15000 });
  ausstehend.td = () => agAendert('td', 'ziel_stadt', 'Lüneburg');
  await knopf.click();
  const hinweis = dlg.getByTestId('bestaetigen-geaendert');
  await hinweis.waitFor({ timeout: 10000 });
  const h = await hinweis.innerText();
  pr('Tour-Detail: Bestätigen angehalten, Hinweis mit Feld (Ziel-Stadt → Lüneburg), Tour unbestätigt',
    /soeben geändert/.test(h) && h.includes('Ziel-Stadt') && h.includes('Lüneburg') && !TOUREN[1].bestaetigt, h);
  await pg.waitForTimeout(800);
  const dialogText = await dlg.innerText();
  pr('Tour-Detail: neu geladen (neuer Stand sichtbar)', dialogText.includes('Lüneburg'), dialogText.slice(0, 300));
  await pg.screenshot({ path: `${OUT}/detail_hinweis_${THEME}.png`, fullPage: true });
  await knopf.click();
  for (let i = 0; i < 40 && !TOUREN[1].bestaetigt; i++) await pg.waitForTimeout(100);
  pr('Tour-Detail: zweiter Klick bestätigt den neuen Stand', TOUREN[1].bestaetigt && log.rpc.at(-1)?.p_stand === STAND2, log.rpc.at(-1));
}
pr('Keine Fehler im Ablauf', fehler.length === 0, fehler);
await b.close();
console.log(f ? `${f} FEHLER` : 'alle ok');
process.exit(f ? 1 : 0);
