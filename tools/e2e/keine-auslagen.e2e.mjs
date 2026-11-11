import { pw, START, BASIS } from './basis.mjs';
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const TEIL = process.argv[4] ?? 'alle'; const MOBIL = process.argv[5] === 'mobil';
// Tourdaten relativ zu heute: Hinweise in der Tourenliste gelten nur für
// Touren der letzten 7 Tage — feste Kalenderdaten würden den Test veralten lassen.
const tagVor = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const TAG = tagVor(3); const TAG_ALT = tagVor(5);
const TAG_DE = TAG.split('-').reverse().join('.');
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i)); } };
const AG = 'ag1';
const agListe = [{ id: AG, name: 'Arval', kontakt: null, rechnungsformat: null, rechnungsadressen: [], kundennummer: null, sachbearbeiter: null, aba_aufschlag_prozent: 0 }];
let zid = 0;
const Z = (tour, kategorie, kennzeichen, betrag = 25) => ({ id: `z${++zid}`, tour_id: tour, kategorie, anzahl: 1, betrag, notiz: null, kennzeichen, created_at: `2026-11-01T10:00:${String(zid).padStart(2, '0')}Z`, dauer_min: null, preis_quelle: null });
const tour = (id, nr, art, kz, zus) => ({
  id, tour_id: nr, start_stadt: 'Bremen', ziel_stadt: 'Hamburg', rueckfuehrung_stadt: art === 'AB' ? null : 'Bremen', kundenname: null, auftraggeber_id: AG, fahrer_id: null, status: 'geplant',
  startdatum: TAG, enddatum: TAG, tourenart: art, kennzeichen: kz, protokoll_art: 'app', schriftliches_protokoll_id: null, greimel_zugang_id: null,
  ist_e_fahrzeug: false, fin: null, eingang_id: null, eingang_id_bc: null, km_gesamt: 100, km_hin: 100, km_rueck: art === 'AB' ? null : 100, bearbeitet_markiert_am: null, bestaetigt: true,
  erstellt_von_rolle: 'admin', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', abgelehnt: false, zurueckgestellt: false, zeit_start: null, zeit_ziel: null,
  auf_eis: false, auf_eis_notiz: null, verguetung: 120, barauslagen: 0, fahrer_honorar: 0, ist_sondervereinbarung: false, sondervereinbarung: null, info: null,
  rechnungsdatum_abweichend: false, rechnungsdatum: null, fin_rueck: null,
  auftraggeber: { id: AG, name: 'Arval', kontakt: null, externe_app_name: null, externe_app_url: null },
  fahrer: null, schriftliches_protokoll: null, protokoll_zuweisungen: [], eingang: null, kontakt: null,
});
const touren = [
  tour('k1', 'T-2026-0201', 'AB', ['HB-AB 1'], []),
  tour('k2', 'T-2026-0202', 'ABA', ['HB-HI 1', 'HH-AB 1234'], []),
  tour('k3', 'T-2026-0203', 'ABA', ['HB-HI 3', 'HH-RU 3'], []),
];
let zusaetze = [Z('k1', 'Maut', 'HB-AB 1', 12), Z('k1', 'Wäsche', 'HB-AB 1', 15), Z('k2', 'Tankauslagen', 'HB-HI 1', 40), Z('k3', 'Keine Auslagen', 'HB-HI 3', 0), Z('k3', 'Keine Auslagen', 'HH-RU 3', 0)];
const mitZ = (t) => ({ ...t, zusaetze: zusaetze.filter((z) => z.tour_id === t.id) });
const log = { zusatzPosts: [], rechnungen: [], positionen: [] };
const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL });
await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
  access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const p = u.pathname; const sp = u.searchParams; const m = req.method();
  if (p.startsWith('/api/emails')) {
    const a = sp.get('action');
    const mail = { id: 'm1', subject: 'Belege Tour T-2026-0202', from: { name: 'Kemal', address: 'k@x.de' }, receivedDateTime: '2026-11-02T08:00:00Z', bodyPreview: 'Anbei', hasAttachments: false, isRead: true, flagged: false, flagStatus: 'notFlagged', inferenceClassification: 'focused', conversationId: 'c1' };
    if (a === 'list' || !a) return json({ value: [mail], totalCount: 1 });
    if (a === 'message') return json({ ...mail, to: [], cc: [], bodyHtml: '<p>Anbei die Belege</p>', bodyContentType: 'html', attachments: [] });
    if (a === 'conversation') return json({ value: [mail] });
    return json({ value: [] });
  }
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const eqW = (k) => { const v = sp.get(k) ?? ''; return v.startsWith('eq.') ? v.slice(3) : ''; };
  const inL = (k) => { const mm = (sp.get(k) ?? '').match(/^in\.\((.*)\)$/); return mm ? mm[1].split(',').map((x) => x.replace(/"/g, '')) : null; };
  const page = (l) => { const o = Number(sp.get('offset') ?? 0); return sp.has('offset') || sp.has('limit') ? l.slice(o, o + Number(sp.get('limit') ?? 1000)) : l; };
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/app_settings') return json(obj ? null : [{ key: 'mail_inbox_1', value: { address: 'info@maja.de', label: 'Info' } }, { key: 'mail_inbox_2', value: { address: 'protokoll@maja.de', label: 'Protokollierung' } }]);
  if (p === '/rest/v1/zusatz_arten') return json([['maut', false], ['wartezeit', false], ['rotekennzeichen', false], ['reifenhandling', false], ['waesche', false], ['keineauslagen', false], ['tankauslagen', true]].map(([s, a]) => ({ schluessel: s, zaehlt_als_auslage: a })));
  if (p === '/rest/v1/auftraggeber') { const ids = inL('id'); const eq = eqW('id'); const l = agListe.filter((a) => (!ids || ids.includes(a.id)) && (!eq || a.id === eq)); return json(obj ? l[0] ?? null : l); }
  if (p === '/rest/v1/tour_zusaetze') {
    if (m === 'POST') {
      const body = JSON.parse(req.postData()); const rows = Array.isArray(body) ? body : [body];
      const neu = rows.map((x) => ({ ...Z(x.tour_id, x.kategorie, x.kennzeichen ?? null, x.betrag), anzahl: x.anzahl, notiz: x.notiz ?? null }));
      log.zusatzPosts.push(...rows); zusaetze.push(...neu);
      return json(obj ? neu[0] : neu, 201);
    }
    if (m === 'DELETE') { const id = eqW('id'); zusaetze = zusaetze.filter((z) => z.id !== id); return r.fulfill({ status: 204 }); }
    const t = eqW('tour_id'); return json(zusaetze.filter((z) => !t || z.tour_id === t));
  }
  if (p === '/rest/v1/rechnungspositionen') { if (m === 'POST') { log.positionen.push(...JSON.parse(req.postData())); return r.fulfill({ status: 201 }); } return json(page([])); }
  if (p === '/rest/v1/rechnungen') {
    if (m === 'POST') { const body = JSON.parse(req.postData()); log.rechnungen.push(body); const row = { id: 'neu1', rechnungsnummer: 'Re_1040' }; return json(obj ? row : [row], 201); }
    return json(obj ? null : page([]));
  }
  if (p === '/rest/v1/rpc/next_rechnungsnummer') return json('Re_1040');
  if (p === '/rest/v1/touren') {
    if (sp.get('select')?.startsWith('kontakt') || sp.get('select') === 'id') return json([]);
    const ids = inL('id'); const eq = eqW('id');
    let l = touren.map(mitZ);
    if (ids) l = l.filter((t) => ids.includes(t.id));
    if (eq) l = l.filter((t) => t.id === eq);
    return obj ? json(l[0] ?? null) : json(page(l));
  }
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('pageerror', e.message));
const B = BASIS;
const card = (nr) => pg.locator('li').filter({ hasText: nr }).first();

if (TEIL === 'alle' || TEIL === 'liste') {
  await pg.goto(`${B}/touren`);
  await pg.getByText('T-2026-0201').first().waitFor({ timeout: 15000 });
  await pg.getByRole('button', { name: /ungeklärten Auslagen/ }).waitFor({ timeout: 10000 });
  pr('Warnleiste: k1 (nur Maut/Wäsche) + k2 (Rück) ungeklärt', (await pg.getByRole('button', { name: /ungeklärten Auslagen/ }).innerText()).startsWith('2 abgeschlossene'));
  const badges = async (nr) => (await card(nr).locator('[data-auslagen]').allInnerTexts()).join(' | ').toLowerCase();
  pr('k1: Zusätze offen (2) + Auslagen ungeklärt', (await badges('T-2026-0201')).includes('zusätze offen (2)') && (await badges('T-2026-0201')).includes('auslagen ungeklärt'), await badges('T-2026-0201'));
  pr('k2: Auslagen offen (1) + ungeklärt (Rück HH-AB 1234)', (await badges('T-2026-0202')).includes('auslagen offen (1)') && (await badges('T-2026-0202')).includes('rück hh-ab 1234'), await badges('T-2026-0202'));
  pr('k3: Keine Auslagen', (await badges('T-2026-0203')) === 'keine auslagen', await badges('T-2026-0203'));
  const kopf = await card('T-2026-0203').getByRole('button', { name: /Zusätze \(/ }).innerText();
  pr('k3: „Zusätze (0)" — Keine Auslagen nicht mitgezählt, abgesetzt', kopf.includes('Zusätze (0)') && kopf.includes('Keine Auslagen (2)'), kopf);
  await pg.screenshot({ path: `${OUT}/ka_liste_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: !MOBIL });
  await card('T-2026-0202').getByRole('button', { name: 'Keine Auslagen', exact: true }).click();
  await pg.waitForTimeout(1200);
  const k2posts = log.zusatzPosts.filter((x) => x.tour_id === 'k2');
  pr('Schnellaktion k2: nur Rück-Kennzeichen erhält „Keine Auslagen"', k2posts.length === 1 && k2posts[0].kennzeichen === 'HH-AB 1234' && k2posts[0].kategorie === 'Keine Auslagen' && k2posts[0].betrag === 0, k2posts);
  if (MOBIL) { await b.close(); console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0); }
}

if (TEIL === 'alle' || TEIL === 'detail') {
  // Tour-Detail k2: „Keine Auslagen" für Hin wird abgelehnt (Tank), dann für Rück ok
  zusaetze = zusaetze.filter((z) => !(z.tour_id === 'k2' && z.kategorie === 'Keine Auslagen'));
  log.zusatzPosts = [];
  await pg.goto(`${B}/touren?tour=k2`);
  await pg.getByTestId('auslagen-tour-status').waitFor({ timeout: 15000 });
  await pg.getByTestId('auslagen-tour-status').getByText(/Ungeklärt: Rück-Kennzeichen HH-AB 1234/).waitFor({ timeout: 8000 });
  pr('Tour-Detail nennt ungeklärtes Rück-Kennzeichen', true);
  await pg.locator('#z-kat').selectOption('Keine Auslagen');
  pr('Keine Auslagen: Anzahl/Betrag ausgeblendet', (await pg.locator('#z-anzahl').count()) === 0 && (await pg.locator('#z-betrag').count()) === 0);
  await pg.locator('#z-kz').selectOption({ index: 1 });
  await pg.getByRole('button', { name: '+ Hinzufügen' }).click();
  await pg.getByText(/hat bereits eine Auslage \(Tankauslagen\)/).waitFor({ timeout: 5000 });
  pr('Konflikt Hin (Tank) → Hinweis, nichts gespeichert', log.zusatzPosts.length === 0);
  await pg.locator('#z-kz').selectOption({ index: 2 });
  await pg.getByRole('button', { name: '+ Hinzufügen' }).click();
  await pg.locator('li[data-keine-auslagen]').first().waitFor({ timeout: 5000 });
  pr('„Keine Auslagen" ohne Anzahl/Betrag gespeichert (Rück)', log.zusatzPosts.length === 1 && log.zusatzPosts[0].kategorie === 'Keine Auslagen' && log.zusatzPosts[0].kennzeichen === 'HH-AB 1234' && log.zusatzPosts[0].anzahl === 1 && log.zusatzPosts[0].betrag === 0, log.zusatzPosts);
  await pg.getByTestId('auslagen-tour-status').locator('[data-auslagen="ungeklaert"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  pr('Danach geklärt (kein Ungeklärt mehr)', (await pg.getByTestId('auslagen-tour-status').innerText()).toLowerCase().includes('ungeklärt') === false, await pg.getByTestId('auslagen-tour-status').innerText());
  pr('Zähler „1 Eintrag" ohne Keine Auslagen', await pg.getByText('1 Eintrag', { exact: true }).isVisible());
  await pg.screenshot({ path: `${OUT}/ka_detail_${THEME}.png`, fullPage: true });
}

if (TEIL === 'alle' || TEIL === 'posteingang') {
  zusaetze = zusaetze.filter((z) => !(z.tour_id === 'k2' && z.kategorie === 'Keine Auslagen'));
  log.zusatzPosts = [];
  await pg.goto(`${B}/posteingang`);
  await pg.getByText(/protokoll@maja\.de/).first().click({ timeout: 15000 });
  await pg.getByText('Belege Tour T-2026-0202').first().click({ timeout: 15000 });
  await pg.getByRole('button', { name: 'Zusätze hinzufügen', exact: true }).click();
  await pg.locator('div.fixed.inset-0').getByText('T-2026-0202').first().click({ timeout: 10000 });
  await pg.locator('#z-kat').waitFor({ timeout: 10000 });
  await pg.locator('#z-kat').selectOption('Keine Auslagen');
  pr('Posteingang: Anzahl/Betrag ausgeblendet', (await pg.locator('#z-anzahl').count()) === 0 && (await pg.locator('#z-betrag').count()) === 0);
  await pg.locator('#z-kz').selectOption('HB-HI 1');
  await pg.getByRole('button', { name: '+ Hinzufügen' }).click();
  await pg.getByText(/hat bereits eine Auslage/).waitFor({ timeout: 5000 });
  pr('Posteingang: Konflikt Hin → Hinweis, nicht gespeichert', log.zusatzPosts.length === 0);
  await pg.locator('#z-kz').selectOption('HH-AB 1234');
  await pg.getByRole('button', { name: '+ Hinzufügen' }).click();
  await pg.getByText('„Keine Auslagen" eingetragen.').waitFor({ timeout: 5000 });
  pr('Posteingang: Keine Auslagen für Rück ohne Anzahl/Wert/Anhang', log.zusatzPosts.length === 1 && log.zusatzPosts[0].kennzeichen === 'HH-AB 1234');
  await pg.locator('#z-kat').selectOption('Tankauslagen');
  await pg.locator('#z-kz').selectOption('HH-AB 1234');
  await pg.locator('#z-betrag').fill('20');
  await pg.getByRole('button', { name: '+ Hinzufügen' }).click();
  await pg.getByText(/ist „Keine Auslagen" eingetragen\. Bitte zuerst entfernen/).waitFor({ timeout: 5000 });
  pr('Posteingang: Auslage, wo „Keine Auslagen" → nicht speichern bis aufgelöst', log.zusatzPosts.length === 1);
  pr('Posteingang: Liste zählt „Keine Auslagen" nicht', await pg.getByText('Eingetragene Zusätze (1)').isVisible());
  await pg.screenshot({ path: `${OUT}/ka_posteingang_${THEME}.png`, fullPage: true });
}

if (TEIL === 'alle' || TEIL === 'rechnung') {
  zusaetze = zusaetze.filter((z) => !(z.tour_id === 'k2' && z.kategorie === 'Keine Auslagen'));
  log.zusatzPosts = []; log.positionen = [];
  await pg.goto(`${B}/rechnungen/neu`);
  await pg.locator('#ag').selectOption(AG);
  await pg.locator('#rdat').fill(TAG);
  await pg.getByRole('button', { name: 'Touren laden' }).click();
  await pg.getByText('T-2026-0202').first().waitFor({ timeout: 10000 }).catch(() => {});
  await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
  const dlg = pg.getByRole('dialog', { name: 'Auslagen prüfen' });
  await dlg.waitFor({ timeout: 10000 });
  // Aufbau seit dem neuen Prüfdialog: eine Karte je Tour, eine Zeile je Kennzeichen.
  const k2 = dlg.locator('section[data-tour="k2"]');
  const k2rueck = await k2.locator('li[data-zeile="rueck"]').innerText();
  pr('Prüfdialog nennt Rück-Kennzeichen von k2', k2rueck.includes('HH-AB 1234') && k2rueck.includes('Auslagen ungeklärt (Rück)'), k2rueck);
  pr('k1 (nur Maut/Wäsche) ungeklärt', (await dlg.locator('section[data-tour="k1"] li[data-status="ungeklaert"]').count()) === 1);
  pr('k3 (Keine Auslagen) kein Hinweis', (await dlg.locator('section[data-tour="k3"]').count()) === 0);
  await pg.screenshot({ path: `${OUT}/ka_pruefdialog_${THEME}${MOBIL ? '_mobil' : ''}.png` });
  await k2.getByRole('button', { name: /Keine Auslagen/ }).click();
  await k2.locator('li[data-zeile="rueck"][data-erledigt]').waitFor({ timeout: 8000 });
  pr('Je Kennzeichen gesetzt: nur Rück', log.zusatzPosts.length === 1 && log.zusatzPosts[0].kennzeichen === 'HH-AB 1234', log.zusatzPosts);
  await dlg.getByRole('button', { name: 'Trotzdem erstellen' }).click();
  await pg.waitForTimeout(1200);
  const kats = log.positionen.map((p) => p.bezeichnung);
  pr('Rechnung: Maut + Wäsche + Tank als Positionen, „Keine Auslagen" nie', kats.some((x) => x.startsWith('Maut')) && kats.some((x) => x.startsWith('Wäsche')) && kats.some((x) => x.startsWith('Tankauslagen')) && !kats.some((x) => /Keine Auslagen/.test(x)), kats);
  pr('Summe ohne Keine Auslagen (3×120 + 12 + 15 + 40 = 427)', Number(log.rechnungen[0]?.netto_summe) === 427, log.rechnungen[0]?.netto_summe);
}
await b.close();
console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0);
