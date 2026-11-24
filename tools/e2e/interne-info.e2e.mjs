// „Interne Info (nur Admin)" + Leerfahrt mit Grund (Migration 120).
//
//   A) Tourenliste (Admin): Badge zeigt den Grund als Tooltip; Klick öffnet
//      den Dialog; „Sonstiges" ohne Text lässt sich nicht speichern; Grund
//      wird an tour_leerfahrt_mit_grund übergeben (Zeile für die interne
//      Info, bisheriges Infofeld unberührt); Grund ändern / entfernen; von
//      Hand geänderte Zeile → Hinweis.
//   B) Tour-Detail (Admin): interne Info mit Schloss/„Nur Admin" beim
//      Infofeld, bearbeiten + speichern (eigene Tabelle).
//   C) Rechnung (Admin): interne Info unter der Position — an derselben
//      Stelle wie das Infofeld.
//   D) Fahrer und Test-Konto: keine Abfrage der internen Info, nichts sichtbar.
//
// Argumente: <Ausgabeordner> <light|dark> [mobil]
import { pw, START, BASIS } from './basis.mjs';
import { erechnungUmgebung, GEHEIM } from './erechnung-umgebung.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const MOBIL = process.argv[4] === 'mobil';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 800)); } };
const tagIn = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const bild = (pg, name) => pg.screenshot({ path: `${OUT}/${name}_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: true });

const AG = { id: 'ag1', name: 'Arval Deutschland GmbH', kontakt: null, externe_app_name: null, externe_app_url: null };
const tour = (id, nr, start, ziel) => ({
  id, tour_id: nr, start_stadt: start, ziel_stadt: ziel, rueckfuehrung_stadt: null, kundenname: 'Kunde', auftraggeber_id: 'ag1', fahrer_id: 'f1',
  status: 'geplant', startdatum: tagIn(-1), enddatum: tagIn(-1), tourenart: 'AB', kennzeichen: ['HB-L 1'], protokoll_art: null,
  schriftliches_protokoll_id: null, greimel_zugang_id: null, ist_e_fahrzeug: false, fin: null, eingang_id: null, eingang_id_bc: null,
  km_gesamt: 100, bearbeitet_markiert_am: null, bestaetigt: true, erstellt_von_rolle: 'admin', created_at: `${tagIn(-5)}T08:00:00Z`, updated_at: `${tagIn(-5)}T08:00:00Z`,
  abgelehnt: false, zurueckgestellt: false, zeit_start: null, zeit_ziel: null, auf_eis: false, auf_eis_notiz: null,
  verguetung: 120, barauslagen: null, fahrer_honorar: null, ist_sondervereinbarung: false, rechnungsdatum_abweichend: false, rechnungsdatum: null,
  info: 'Info für alle', auftraggeber: AG, fahrer: null, schriftliches_protokoll: null, protokoll_zuweisungen: [], zusaetze: [], eingang: null,
});

/** Kontext mit Stub; rolle admin|fahrer|test, sicht = Test-Konto-Sicht. */
async function starte(rolle, sicht) {
  const TOUREN = [tour('t1', 'T-2026-0601', 'Bremen', 'Hamburg'), tour('t2', 'T-2026-0602', 'Stuhr', 'Kiel')];
  const leerfahrt = new Set(['t1']);
  const info = new Map([['t1', { interne_info: 'Kunde zahlt schlecht\nLeerfahrt – Fahrzeug defekt (Bremse blockiert)', leerfahrt_grund: 'defekt', leerfahrt_text: 'Bremse blockiert' }]]);
  const log = { rpc: [], adminInfo: [], patches: [], upserts: [] };
  const b = await pw.chromium.launch(START);
  const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL });
  await ctx.addInitScript(([uid, theme, s]) => {
    localStorage.setItem('maja-theme', theme);
    localStorage.setItem('maja-logistik-auth', JSON.stringify({ access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } }));
    if (s) localStorage.setItem('maja:test-mode:effective-role', s);
  }, [UID, THEME, sicht]);
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.hostname !== 'stub.supabase.co') return r.continue();
    const p = u.pathname; const sp = u.searchParams; const m = req.method();
    const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } };
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
    if (p === '/rest/v1/app_users') { const a = { id: UID, role: rolle, email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null }; return json(obj ? a : [a]); }
    if (p === '/rest/v1/fahrer') { const fa = { id: 'f1', user_id: UID, aktiv: true, vorname: 'Kemal', nachname: 'Y', ist_unterkonto: false, haupt_user_id: null, user: null }; return json(obj ? fa : [fa]); }
    if (p === '/rest/v1/auftraggeber') return json(obj ? AG : [AG]);
    if (p === '/rest/v1/tour_leerfahrt') return json([...leerfahrt].map((id) => ({ tour_id: id, gesetzt_am: `${tagIn(-1)}T09:00:00Z`, gesetzt_von_name: 'Ad Min' })));
    if (p === '/rest/v1/touren_admin_info') {
      log.adminInfo.push(`${m} ${u.search}`);
      if (rolle !== 'admin') return json(obj ? null : []);  // RLS: nur Admin
      if (m === 'POST') { const x = body(); log.upserts.push(x); for (const z of (Array.isArray(x) ? x : [x])) info.set(z.tour_id, { ...(info.get(z.tour_id) ?? {}), ...z }); return json([], 201); }
      const ids = (sp.get('tour_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
      const l = [...info.entries()].filter(([id]) => !ids.length || ids.includes(id)).map(([id, v]) => ({ tour_id: id, ...v }));
      return json(sp.get('limit') === '1' ? l.slice(0, 1) : l);
    }
    if (p === '/rest/v1/rpc/tour_leerfahrt_mit_grund') {
      const a = body(); log.rpc.push(a);
      if (a.p_an) {
        const neu = !leerfahrt.has(a.p_tour_id); leerfahrt.add(a.p_tour_id);
        const alt = info.get(a.p_tour_id) ?? { interne_info: null };
        info.set(a.p_tour_id, { interne_info: [alt.interne_info, a.p_zeile].filter(Boolean).join('\n'), leerfahrt_grund: a.p_grund, leerfahrt_text: a.p_text });
        return json({ geaendert: neu, neu_markiert: neu, info_manuell: false });
      }
      leerfahrt.delete(a.p_tour_id);
      // Simuliert: Zeile wurde von Hand geändert → Server fasst sie nicht an.
      info.set(a.p_tour_id, { ...info.get(a.p_tour_id), leerfahrt_grund: null, leerfahrt_text: null });
      return json({ geaendert: true, entfernt: 1, info_manuell: true });
    }
    if (p === '/rest/v1/touren') {
      if (m === 'PATCH') { log.patches.push(body()); return json(obj ? TOUREN[0] : []); }
      let l = TOUREN;
      const id = sp.get('id') ?? '';
      if (id.startsWith('eq.')) l = l.filter((t) => t.id === id.slice(3));
      if (id.startsWith('in.(')) { const ids = id.slice(4, -1).split(','); l = l.filter((t) => ids.includes(t.id)); }
      if (sp.get('bestaetigt') === 'eq.false' || sp.get('auf_eis') === 'eq.true') l = [];
      if (obj) return json(l[0] ?? null);
      const o = Number(sp.get('offset') ?? 0);
      return json(sp.has('limit') ? l.slice(o, o + Number(sp.get('limit'))) : l);
    }
    if (m === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });
    return json(obj ? null : []);
  });
  const pg = await ctx.newPage();
  const fehler = []; pg.on('pageerror', (e) => fehler.push(e.message));
  return { b, pg, log, fehler, info, leerfahrt };
}

// ------------------------------------------------------------------ A) Tourenliste
{
  const { b, pg, log, fehler, info } = await starte('admin');
  await pg.goto(`${BASIS}/touren`);
  await pg.getByText('T-2026-0601').first().waitFor({ timeout: 20000 });
  const badge = (id) => pg.locator('[data-leerfahrt]').nth(id === 't1' ? 0 : 1);
  await pg.locator('[data-leerfahrt="ja"]').first().waitFor({ timeout: 10000 });
  const titel = await pg.locator('[data-leerfahrt="ja"]').first().getAttribute('title');
  pr('Badge zeigt den Grund als Tooltip', /Fahrzeug defekt \(Bremse blockiert\)/.test(titel ?? ''), titel);

  // t2: neu markieren
  await pg.locator('[data-leerfahrt="nein"]').first().click();
  const dlg = pg.getByTestId('leerfahrt-dialog');
  await dlg.waitFor({ timeout: 10000 });
  const knopf = dlg.getByRole('button', { name: 'Als Leerfahrt markieren' });
  pr('Ohne Grund: Speichern nicht möglich', await knopf.isDisabled());
  await dlg.getByLabel('Sonstiges:').check();
  pr('Sonstiges ohne Text: Speichern nicht möglich', await knopf.isDisabled());
  await dlg.locator('#leerfahrt-sonstiges').fill('Kunde nicht angetroffen');
  pr('Sonstiges mit Text: Speichern möglich, Vorschau der Zeile', !(await knopf.isDisabled()) && (await dlg.innerText()).includes('Leerfahrt – Kunde nicht angetroffen'));
  await dlg.getByLabel('Fahrzeug ohne Bereifung').check();
  await dlg.locator('#leerfahrt-ergaenzung').fill('Sommerreifen fehlen');
  await bild(pg, 'leerfahrt_dialog');
  await knopf.click();
  await pg.getByTestId('leerfahrt-meldung').waitFor({ timeout: 10000 });
  const a1 = log.rpc[0];
  pr('Grund an den Server: Code, Ergänzung, Zeile „Leerfahrt – Fahrzeug ohne Bereifung (Sommerreifen fehlen)"',
    a1?.p_an === true && a1.p_tour_id === 't2' && a1.p_grund === 'ohne_bereifung' && a1.p_text === 'Sommerreifen fehlen'
      && a1.p_zeile === 'Leerfahrt – Fahrzeug ohne Bereifung (Sommerreifen fehlen)', a1);
  pr('Bisheriges Infofeld nicht angefasst (kein Schreiben an touren.info)', !log.patches.some((x) => x && 'info' in x), log.patches);

  // t1: Grund ändern (Dialog mit aktuellem Grund)
  await pg.waitForTimeout(500);
  await pg.locator('[data-leerfahrt="ja"]').first().click();
  await dlg.waitFor({ timeout: 10000 });
  pr('Bereits Leerfahrt: aktueller Grund vorausgewählt, Ergänzung vorbelegt',
    await dlg.getByLabel('Fahrzeug defekt').isChecked() && (await dlg.locator('#leerfahrt-ergaenzung').inputValue()) === 'Bremse blockiert');
  await dlg.getByLabel('Kurzfristiger Storno').check();
  await dlg.locator('#leerfahrt-ergaenzung').fill('');
  await dlg.getByRole('button', { name: 'Grund speichern' }).click();
  for (let i = 0; i < 30 && log.rpc.length < 2; i++) await pg.waitForTimeout(100);
  pr('Grund ändern: neue Zeile „Leerfahrt – Kurzfristiger Storno"', log.rpc[1]?.p_grund === 'kurzfristiger_storno' && log.rpc[1]?.p_zeile === 'Leerfahrt – Kurzfristiger Storno', log.rpc[1]);

  // t1: entfernen → Server meldet „von Hand geändert"
  await pg.waitForTimeout(500);
  await pg.locator('[data-leerfahrt="ja"]').first().click();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: 'Leerfahrt entfernen' }).click();
  await dlg.getByRole('button', { name: 'Ja, Leerfahrt entfernen' }).click();
  const meldung = pg.getByTestId('leerfahrt-meldung');
  await meldung.waitFor({ timeout: 10000 });
  await pg.waitForTimeout(300);
  const mt = await meldung.innerText();
  pr('Entfernen: p_an=false; von Hand geänderte Zeile → Hinweis „bitte selbst anpassen"',
    log.rpc.at(-1)?.p_an === false && /manuell geändert — bitte selbst anpassen/.test(mt), { rpc: log.rpc.at(-1), mt });
  await bild(pg, 'leerfahrt_hinweis');
  pr('Tourenliste: keine Fehler', fehler.length === 0, fehler);
  void info;
  await b.close();
}

// ------------------------------------------------------------------ B) Tour-Detail
{
  const { b, pg, log, fehler } = await starte('admin');
  await pg.goto(`${BASIS}/touren`);
  await pg.getByText('T-2026-0601').first().click({ timeout: 20000 });
  const block = pg.getByTestId('interne-info');
  await block.waitFor({ timeout: 15000 });
  const container = block.locator('..');
  const ct = await container.innerText();
  pr('Tour-Detail: interne Info mit „Nur Admin" beim Infofeld, inkl. Leerfahrt-Zeile',
    /Nur Admin/i.test(ct) && ct.includes('Kunde zahlt schlecht') && ct.includes('Leerfahrt – Fahrzeug defekt (Bremse blockiert)'), ct);
  pr('Tour-Detail: Leerfahrt-Leiste nennt den Grund', (await pg.getByTestId('leerfahrt-grund').innerText()).includes('Fahrzeug defekt (Bremse blockiert)'));
  await bild(pg, 'detail_ansicht');
  await pg.getByRole('button', { name: 'Bearbeiten' }).last().click();
  const feld = pg.locator('#td-interne-info');
  await feld.waitFor({ timeout: 10000 });
  pr('Bearbeiten: Feld „Interne Info" vorbelegt', (await feld.inputValue()).startsWith('Kunde zahlt schlecht'));
  await feld.fill('Kunde zahlt schlecht\nLeerfahrt – Fahrzeug defekt (Bremse blockiert)\nRückruf am Montag');
  await bild(pg, 'detail_bearbeiten');
  await pg.getByRole('button', { name: 'Speichern', exact: true }).last().click();
  for (let i = 0; i < 50 && !log.upserts.length; i++) await pg.waitForTimeout(100);
  const up = [log.upserts[0]].flat()[0];
  pr('Speichern: interne Info in eigene Tabelle (upsert), Infofeld bleibt im Tour-Update unverändert',
    up?.tour_id === 't1' && up.interne_info.endsWith('Rückruf am Montag') && log.patches.every((x) => !x || x.info === undefined || x.info === 'Info für alle'), { up, patches: log.patches.map((x) => x?.info) });
  pr('Tour-Detail: keine Fehler', fehler.length === 0, fehler);
  await b.close();
}

// ------------------------------------------------------------------ C) Rechnung: Positionen
{
  const env = await erechnungUmgebung({ OUT, THEME, MOBIL });
  const { pg, b } = env;
  await pg.goto(`${BASIS}/rechnungen/r1`);
  await pg.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click({ timeout: 20000 });
  const zeilen = pg.getByTestId('interne-info-zeile');
  await zeilen.first().waitFor({ timeout: 10000 });
  const texte = await zeilen.allInnerTexts();
  pr('Rechnung bearbeiten: interne Info unter den Tour-Positionen (2 Touren), nicht unter der manuellen Position',
    texte.length === 2 && texte.every((t) => t.includes(GEHEIM)), texte);
  await bild(pg, 'rechnung_positionen');
  await b.close();
}

// ------------------------------------------------------------------ D) Fahrer und Test-Konto
for (const [rolle, sicht, name] of [['fahrer', null, 'Fahrer'], ['test', 'fahrer', 'Test-Konto (Sicht Fahrer)'], ['test', 'auftraggeber', 'Test-Konto (Sicht Auftraggeber)']]) {
  const { b, pg, log, fehler } = await starte(rolle, sicht);
  await pg.goto(`${BASIS}/touren`);
  await pg.waitForLoadState('networkidle').catch(() => {});
  await pg.waitForTimeout(800);
  if (await pg.getByText('T-2026-0601').count()) {
    await pg.getByText('T-2026-0601').first().click().catch(() => {});
    await pg.waitForTimeout(1200);
  }
  const text = await pg.locator('body').innerText();
  pr(`${name}: keine Abfrage der internen Info, nichts sichtbar`, log.adminInfo.length === 0 && !/Interne Info|Kunde zahlt schlecht|Bremse blockiert/.test(text) && fehler.length === 0,
    { abfragen: log.adminInfo, fehler });
  await b.close();
}

console.log(f ? `${f} FEHLER` : 'alle ok');
process.exit(f ? 1 : 0);
