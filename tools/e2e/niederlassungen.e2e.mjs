// Niederlassungen (Migration 118): Verwaltung im Auftraggeber-Dialog (Admin)
// und Sicht eines Auftraggeber-Kontos.
//
//   Teil A (Admin): Hauptsitz-Bezeichnung, Niederlassung anlegen (Bezeichnung
//     leer → Ort), deaktivieren, Löschen scheitert an verknüpften Touren mit
//     verständlicher Meldung, Hauptsitz-Bezeichnung wird mit dem Auftraggeber
//     gespeichert.
//   Teil B (Auftraggeber-Konto): sieht die Touren beider Standorte mit
//     Standort-Kennzeichnung, keine Preise; beim Anlegen einer Tour ist der
//     Standort wählbar und geht an ag_tour_anlegen.
//
// Argumente: <Ausgabeordner> <light|dark> [mobil]
import { pw, START, BASIS } from './basis.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const MOBIL = process.argv[4] === 'mobil';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 800)); } };
const tagIn = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const AG = { id: 'ag1', name: 'Arval Deutschland GmbH', strasse: 'Heiligenroder Str. 38e', plz: '28816', ort: 'Stuhr', land_code: 'DE',
  email1: 'rechnung@arval.example', email2: null, kontakt: null, hauptsitz_bezeichnung: null, zahlungsziel_tage: 14 };
const NL_BREMEN = { id: 'nl1', auftraggeber_id: 'ag1', bezeichnung: 'Bremen', strasse: 'Hafenstraße 5', plz: '28217', ort: 'Bremen', land_code: 'DE',
  rechnungs_email: null, erechnung_email: null, kaeufer_referenz: null, kundennummer: null, ansprechpartner: null, aktiv: true };
const kundenTour = (id, tid, start, ziel, nl) => ({
  id, tour_id: tid, start_stadt: start, ziel_stadt: ziel, rueckfuehrung_stadt: null, kundenname: 'Kunde', auftraggeber_id: 'ag1',
  startdatum: tagIn(3), enddatum: tagIn(3), tourenart: 'AB', kennzeichen: ['HB-AR 1'], ist_e_fahrzeug: false, fin: null,
  adresse_start: null, adresse_ziel: null, adresse_rueckfuehrung: null, strasse_start: null, plz_start: null, strasse_ziel: null, plz_ziel: null,
  strasse_rueckfuehrung: null, plz_rueckfuehrung: null, kontakt_start: null, kontakt_ziel: null, kontakt_rueckfuehrung: null,
  protokoll_art: null, info: null, bestaetigt: true, erstellt_von: null, created_at: `${tagIn(-5)}T08:00:00Z`, auf_eis: false, auf_eis_notiz: null,
  abgelehnt: false, ablehnungsgrund: null, abgelehnt_am: null, ablehnung_bestaetigt_am: null, eingang_id: null, eingang_id_bc: null,
  status: 'geplant', niederlassung_id: nl,
});

async function starte(rolle, { nls, touren = [] }) {
  const log = { schreib: [], rpc: [], abfragen: [] };
  const b = await pw.chromium.launch(START);
  const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL });
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
    const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } };
    if (m === 'GET') log.abfragen.push(`${p}?${u.search}`);
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
    if (p === '/rest/v1/app_users') {
      const a = { id: UID, role: rolle, email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: rolle === 'auftraggeber' ? 'ag1' : null };
      return json(obj ? a : [a]);
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.slice('/rest/v1/rpc/'.length);
      log.rpc.push({ name, args: body() });
      if (name === 'ag_tour_anlegen') return json({ ok: true, id: 'neu1' });
      return json(null);
    }
    if (p === '/rest/v1/auftraggeber') {
      if (m === 'PATCH') { log.schreib.push({ m, p, body: body() }); return json([]); }
      return json(obj ? AG : [AG]);
    }
    if (p === '/rest/v1/auftraggeber_niederlassungen') {
      if (m === 'POST') {
        const x = body(); log.schreib.push({ m, p, body: x });
        const neu = { id: 'nl-neu', aktiv: true, ...x };
        nls.push(neu);
        return json(obj ? neu : [neu], 201);
      }
      if (m === 'PATCH') {
        const id = (sp.get('id') ?? '').slice(3); const x = body(); log.schreib.push({ m, p, id, body: x });
        const n = nls.find((y) => y.id === id); if (n) Object.assign(n, x);
        return json(obj ? n : [n]);
      }
      if (m === 'DELETE') {
        const id = (sp.get('id') ?? '').slice(3); log.schreib.push({ m, p, id });
        return json({ code: '23503', message: 'update or delete on table "auftraggeber_niederlassungen" violates foreign key constraint "touren_niederlassung_id_fkey" on table "touren"', details: null, hint: null }, 409);
      }
      return json(nls.filter((n) => !sp.get('auftraggeber_id') || `eq.${n.auftraggeber_id}` === sp.get('auftraggeber_id')));
    }
    if (p === '/rest/v1/touren_kundensicht') {
      const o = Number(sp.get('offset') ?? 0);
      return json(sp.has('limit') ? touren.slice(o, o + Number(sp.get('limit'))) : touren);
    }
    if (m !== 'GET' && m !== 'HEAD') log.schreib.push({ m, p, body: body() });
    return json(obj ? null : []);
  });
  const pg = await ctx.newPage();
  const fehler = []; pg.on('pageerror', (e) => fehler.push(e.message));
  return { b, pg, log, fehler };
}
const bild = (pg, name) => pg.screenshot({ path: `${OUT}/${name}_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: true });

// ------------------------------------------------------------------ Teil A
{
  const nls = [];
  const { b, pg, log, fehler } = await starte('admin', { nls });
  await pg.goto(`${BASIS}/einstellungen/auftraggeber`);
  await pg.getByRole('button', { name: 'Bearbeiten' }).first().click({ timeout: 20000 });
  const bereich = pg.getByTestId('niederlassungen');
  await bereich.waitFor({ timeout: 15000 });
  await bereich.scrollIntoViewIfNeeded();
  const hs = await pg.getByTestId('hauptsitz').innerText();
  pr('Verwaltung: Abschnitt „Niederlassungen" mit Hauptsitz oben (Adresse des Auftraggebers)',
    hs.includes('Heiligenroder Str. 38e') && hs.includes('28816 Stuhr') && (await pg.locator('#ag-hauptsitz').getAttribute('placeholder')) === 'Stuhr', hs);

  await pg.getByRole('button', { name: '+ Niederlassung hinzufügen' }).click();
  const zeile = bereich.locator('li[data-niederlassung="neu"]');
  const feld = async (name) => zeile.locator(`[id$="-${name}"]`).first();
  await (await feld('strasse')).fill('Hafenstraße 5');
  await (await feld('plz')).fill('28217');
  await (await feld('ort')).fill('Bremen');
  await (await feld('rechnungs_email')).fill('');
  await bild(pg, 'verwaltung_neu');
  if (MOBIL) {
    const breite = await pg.evaluate(() => ({ innen: window.innerWidth, inhalt: document.documentElement.scrollWidth }));
    pr('Mobil: kein seitliches Überstehen (Seite so breit wie der Bildschirm)', breite.innen <= 390 && breite.inhalt <= 390, breite);
  }
  await zeile.getByRole('button', { name: 'Niederlassung speichern' }).click();
  await bereich.getByText('Niederlassung „Bremen" gespeichert.').waitFor({ timeout: 10000 }).catch(() => {});
  const post = log.schreib.find((x) => x.m === 'POST' && x.p.endsWith('auftraggeber_niederlassungen'));
  pr('Anlegen: leere Bezeichnung → Ort „Bremen", Adresse + DE, abweichende Felder leer (= vom Auftraggeber)',
    post?.body?.bezeichnung === 'Bremen' && post.body.auftraggeber_id === 'ag1' && post.body.strasse === 'Hafenstraße 5' && post.body.plz === '28217'
      && post.body.land_code === 'DE' && post.body.rechnungs_email === null && post.body.kundennummer === null, post);

  // Gleicher Name wie der Hauptsitz wird abgefangen.
  await pg.getByRole('button', { name: '+ Niederlassung hinzufügen' }).click();
  const zweite = bereich.locator('li[data-niederlassung="neu"]');
  await zweite.locator('[id$="-ort"]').first().fill('Stuhr');
  await zweite.getByRole('button', { name: 'Niederlassung speichern' }).click();
  const meldung = await bereich.getByRole('alert').innerText().catch(() => '');
  pr('Bezeichnung = Hauptsitz wird abgelehnt (eindeutig benennen)', /schon die Bezeichnung des Hauptsitzes/.test(meldung)
    && log.schreib.filter((x) => x.m === 'POST' && x.p.endsWith('auftraggeber_niederlassungen')).length === 1, meldung);
  await zweite.getByRole('button', { name: 'Verwerfen' }).click();

  const bremen = bereich.locator('li[data-niederlassung="Bremen"]');
  await bremen.getByRole('button', { name: 'Deaktivieren' }).click();
  await bremen.getByText('inaktiv').waitFor({ timeout: 5000 }).catch(() => {});
  const patchNl = log.schreib.find((x) => x.m === 'PATCH' && x.p.endsWith('auftraggeber_niederlassungen'));
  pr('Deaktivieren: aktiv=false, Kennzeichnung „inaktiv"', patchNl?.body?.aktiv === false && (await bremen.getByText('inaktiv').count()) === 1, patchNl);

  pg.once('dialog', (d) => void d.accept());
  await bremen.getByRole('button', { name: 'Löschen' }).click();
  const fk = await bereich.getByRole('alert').innerText({ timeout: 5000 }).catch(() => '');
  pr('Löschen mit verknüpften Touren: verständliche Meldung, Eintrag bleibt', /kann nicht gelöscht werden/.test(fk) && /Deaktivieren/.test(fk)
    && (await bremen.count()) === 1, fk);

  await pg.locator('#ag-hauptsitz').fill('Stuhr (Zentrale)');
  await bild(pg, 'verwaltung');
  await pg.getByRole('button', { name: 'Speichern', exact: true }).click();
  for (let i = 0; i < 50 && !log.schreib.some((x) => x.m === 'PATCH' && x.p === '/rest/v1/auftraggeber'); i++) await pg.waitForTimeout(100);
  const agPatch = log.schreib.find((x) => x.m === 'PATCH' && x.p === '/rest/v1/auftraggeber');
  pr('Hauptsitz-Bezeichnung wird mit dem Auftraggeber gespeichert', agPatch?.body?.hauptsitz_bezeichnung === 'Stuhr (Zentrale)', agPatch?.body);
  pr('Verwaltung: keine Fehler im Ablauf', fehler.length === 0, fehler);
  await b.close();
}

// ------------------------------------------------------------------ Teil B
{
  const nls = [{ ...NL_BREMEN }];
  const touren = [kundenTour('t1', 'T-2026-0801', 'Stuhr', 'Hannover', null), kundenTour('t2', 'T-2026-0802', 'Bremen', 'Lübeck', 'nl1')];
  const { b, pg, log, fehler } = await starte('auftraggeber', { nls, touren });
  await pg.goto(`${BASIS}/touren`);
  await pg.getByText('T-2026-0801').first().waitFor({ timeout: 20000 }).catch(async (e) => {
    await bild(pg, 'debug_ag_konto');
    console.log('DEBUG', (await pg.locator('body').innerText()).slice(0, 800), log.abfragen.slice(-15));
    throw e;
  });
  const badges = await pg.getByTestId('ag-tour-standort').allInnerTexts();
  pr('Auftraggeber-Konto: Touren beider Standorte mit Kennzeichnung „Stuhr" / „Bremen"',
    (await pg.getByText('T-2026-0802').count()) > 0 && badges.some((x) => x.includes('Stuhr')) && badges.some((x) => x.includes('Bremen')), badges);
  const text = await pg.locator('body').innerText();
  pr('Auftraggeber-Konto: keine Preise (Kundensicht ohne Vergütung, kein €-Betrag)',
    !/€|EUR\b|Vergütung/.test(text) && log.abfragen.some((q) => q.startsWith('/rest/v1/touren_kundensicht'))
      && !log.abfragen.some((q) => q.startsWith('/rest/v1/touren?')), log.abfragen.filter((q) => q.includes('touren')));
  await bild(pg, 'ag_konto_liste');

  await pg.getByRole('button', { name: '+ Neue Tour' }).first().click();
  const auswahl = pg.locator('#at-niederlassung');
  await auswahl.waitFor({ timeout: 10000 });
  const optionen = await auswahl.locator('option').allInnerTexts();
  pr('Neue Tour: Standort wählbar — „Stuhr (Hauptsitz)" und „Bremen — 28217 Bremen", Vorgabe Hauptsitz',
    optionen.length === 2 && optionen[0].includes('Stuhr (Hauptsitz)') && optionen[1].includes('Bremen — 28217 Bremen') && (await auswahl.inputValue()) === '', optionen);
  await auswahl.selectOption('nl1');
  await pg.locator('#at-art').selectOption('AB');
  await pg.locator('#at-kunde').fill('Privatkunde Test');
  await pg.locator('#at-kz').fill('HB-NL 1');
  await pg.locator('#at-fin').fill('WVWZZZ1KZAW000009');
  await pg.locator('#at-st1-strasse').fill('Hafenstraße 5');
  await pg.locator('#at-st1-plz').fill('28217');
  await pg.locator('#at-st1-stadt').fill('Bremen');
  await pg.locator('#at-st1-k-1-name').fill('Frau Abholer');
  await pg.locator('#at-st2-strasse').fill('Holstentor 1');
  await pg.locator('#at-st2-plz').fill('23552');
  await pg.locator('#at-st2-stadt').fill('Lübeck');
  await pg.locator('#at-st2-k-1-name').fill('Herr Empfang');
  await pg.locator('#at-von').fill(tagIn(5));
  await pg.locator('#at-bis').fill(tagIn(5));
  await bild(pg, 'ag_konto_neue_tour');
  await pg.getByRole('button', { name: 'Tour einreichen' }).click();
  for (let i = 0; i < 50 && !log.rpc.some((x) => x.name === 'ag_tour_anlegen'); i++) await pg.waitForTimeout(100);
  const anlegen = log.rpc.find((x) => x.name === 'ag_tour_anlegen');
  const daten = anlegen?.args?.p_daten ?? {};
  pr('Neue Tour: Standort „Bremen" geht an ag_tour_anlegen, ohne Preis-/Auftraggeber-Felder',
    daten.niederlassung_id === 'nl1' && !('verguetung' in daten) && !('auftraggeber_id' in daten),
    anlegen ?? (await pg.getByRole('alert').allInnerTexts().catch(() => [])));
  pr('Auftraggeber-Konto: keine Fehler im Ablauf', fehler.length === 0, fehler);
  await b.close();
}

console.log(f ? `${f} FEHLER` : 'alle ok');
process.exit(f ? 1 : 0);
