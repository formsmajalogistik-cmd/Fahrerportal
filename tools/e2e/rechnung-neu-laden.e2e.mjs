import { pw, START, BASIS } from './basis.mjs';
const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light'; const TEIL = process.argv[4] ?? 'alle'; const MOBIL = process.argv[5] === 'mobil';
const UID = '00000000-0000-0000-0000-0000000000a1';
let f = 0; const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { f++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i)); } };
const AG = 'ag1';
const agListe = [{ id: AG, name: 'Arval', kontakt: null, rechnungsformat: null, rechnungsadressen: [], kundennummer: null, sachbearbeiter: null, aba_aufschlag_prozent: 0, kunden_uid: null, zahlungsziel_tage: 14 }, { id: 'ag2', name: 'Sixt', rechnungsformat: null, rechnungsadressen: [] }];
let zn = 0;
const Z = (tour, kategorie, kennzeichen, betrag = 25) => ({ id: `z${++zn}`, tour_id: tour, kategorie, anzahl: 1, betrag, notiz: null, kennzeichen, created_at: '2026-10-01T10:00:00Z' });
const T = (id, nr, ag, end, extra = {}) => ({
  id, tour_id: nr, auftraggeber_id: ag, kontakt_id: null, start_stadt: 'Bremen', ziel_stadt: 'Hamburg', rueckfuehrung_stadt: null, startdatum: end, enddatum: end,
  tourenart: 'AB', kennzeichen: [`HB-${nr.slice(-3)}`], kundenname: null, fin: null, fin_rueck: null, km_hin: 100, km_rueck: null, km_gesamt: 100,
  sondervereinbarung: null, verguetung: 120, info: null, rechnungsdatum_abweichend: false, rechnungsdatum: null, status: 'abgeschlossen', ...extra,
});
const touren = [
  T('t1', 'T-2026-0301', AG, '2026-10-01', { verguetung: 130 }),
  T('t2', 'T-2026-0302', AG, '2026-10-01'),
  T('t3', 'T-2026-0303', AG, '2026-09-28', { rechnungsdatum_abweichend: true, rechnungsdatum: '2026-10-01' }),
  T('t4', 'T-2026-0304', AG, '2026-10-01'),
  T('t5', 'T-2026-0305', 'ag2', '2026-10-01'),
  T('t6', 'T-2026-0306', AG, '2026-10-02'),
  // Prüfdialog
  T('pa', 'T-2026-4419', AG, '2026-10-28', { kennzeichen: ['HH-AB 1234'] }),
  T('pb', 'T-2026-4431', AG, '2026-10-29', { tourenart: 'ABA', start_stadt: 'Stuhr', ziel_stadt: 'Berlin', rueckfuehrung_stadt: 'Stuhr', kennzeichen: ['HB-XY 55', 'B-CD 789'] }),
  T('pc', 'T-2026-4440', AG, '2026-10-30', { start_stadt: 'Oldenburg', ziel_stadt: 'Kiel', kennzeichen: ['OL-ZZ 12'] }),
  ...Array.from({ length: 22 }, (_, i) => T(`v${i}`, `T-2026-5${String(i).padStart(3, '0')}`, AG, `2026-10-${String(1 + i).padStart(2, '0')}`, { kennzeichen: [`HB-V ${i}`] })),
];
let zusaetze = [Z('pb', 'Tankauslagen', 'HB-XY 55', 40), Z('pc', 'Tankauslagen', 'OL-ZZ 12', 54.2), Z('pc', 'Wäsche', 'OL-ZZ 12', 15)];
const tankPb = zusaetze[0].id;
const re = (id, nr, extra = {}) => ({ id, rechnungsnummer: nr, auftraggeber_id: AG, datum: '2026-10-01', leistungszeitraum_von: '2026-10-01', leistungszeitraum_bis: '2026-10-01', status: 'entwurf', ist_auslagen_rechnung: false, netto_summe: 0, brutto_summe: 0, ust_satz: 19, ust_betrag: 0, empfaenger_typ: 'auftraggeber', rechnungsempfaenger_id: null, pdf_url: null, belege_pdf_url: null, email_versendet_am: null, notizen: null, mit_unterschrift: true, mit_stempel: true, created_at: '2026-10-01T10:00:00Z', ...extra });
const rechnungen = {
  rLeer: re('rLeer', 'Re_1050', { leistungszeitraum_von: '2026-11-05', leistungszeitraum_bis: '2026-11-05' }),
  rVoll: re('rVoll', 'Re_1051'),
  rX: re('rX', 'Re_1052'),
  rVers: re('rVers', 'Re_1053', { status: 'offen' }),
  rPruef: re('rPruef', 'Re_1054', { datum: '2026-10-31' }),
  rViel: re('rViel', 'Re_1055', { datum: '2026-10-31' }),
};
const P = (rid, tour, zusatz = null, preis = 100) => ({ id: `p${Math.random().toString(36).slice(2, 8)}`, rechnung_id: rid, position_nr: 1, bezeichnung: `Bremen nach Hamburg ${tour}`, unterzeilen: [], menge: 1, einzelpreis: preis, gesamtpreis: preis, tour_id: tour, zusatz_id: zusatz, ist_manuell: false, ust_satz: null });
let pos = [P('rVoll', 't1', null, 100), P('rX', 't4'), P('rVers', 't6'), P('rPruef', 'pa'), P('rPruef', 'pb'), P('rPruef', 'pb', tankPb, 40), P('rPruef', 'pc'),
  ...Array.from({ length: 22 }, (_, i) => P('rViel', `v${i}`))];
const log = { posPosts: [], rePatches: [], zusatzPosts: [], inserts: [] };
const evalOr = (t, or) => [...or.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1].split(',')).some((g) => g.every((c) => {
  const [col, op, ...rest] = c.split('.'); const v = rest.join('.'); const tv = t[col];
  if (op === 'eq') return String(tv) === v; if (op === 'is') return tv === null || tv === undefined;
  if (op === 'gte') return tv != null && tv >= v; if (op === 'lte') return tv != null && tv <= v; return false;
}));
const b = await pw.chromium.launch(START);
const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 950 }, isMobile: MOBIL });
await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
  access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
await ctx.route('**/*', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (u.hostname !== 'stub.supabase.co') return r.continue();
  const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
  const p = u.pathname; const sp = u.searchParams; const m = req.method();
  const eqW = (k) => { const v = sp.get(k) ?? ''; return v.startsWith('eq.') ? v.slice(3) : ''; };
  const inL = (k) => { const v = sp.getAll(k).find((x) => x.startsWith('in.')) ?? ''; const mm = v.match(/^in\.\((.*)\)$/); return mm ? mm[1].split(',').map((x) => x.replace(/"/g, '')) : null; };
  const page = (l) => { const o = Number(sp.get('offset') ?? 0); return sp.has('offset') || sp.has('limit') ? l.slice(o, o + Number(sp.get('limit') ?? 1000)) : l; };
  const mitZ = (t) => ({ ...t, zusaetze: zusaetze.filter((z) => z.tour_id === t.id) });
  if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
  if (p === '/rest/v1/app_users') { const a = { id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true }; return json(obj ? a : [a]); }
  if (p === '/rest/v1/zusatz_arten') return json([['maut', false], ['waesche', false], ['keineauslagen', false]].map(([s, a]) => ({ schluessel: s, zaehlt_als_auslage: a })));
  if (p === '/rest/v1/auftraggeber') { const ids = inL('id'); const eq = eqW('id'); const l = agListe.filter((a) => (!ids || ids.includes(a.id)) && (!eq || a.id === eq)); return json(obj ? l[0] ?? null : l); }
  if (p === '/rest/v1/beleg_versand') {
    const ids = inL('rechnung_id');
    return json(ids && ids.includes('rVers') ? [{ id: 'v1', rechnung_id: 'rVers', gutschrift_id: null, art: 'app', weg: 'app', datum: '2026-10-02', zeitpunkt: '2026-10-02T08:00:00Z', empfaenger: ['b@arval.de'], cc: [], absender: null, betreff: null, notiz: null, fehler: null, quelle: 'app', erstellt_von: null, erstellt_von_name: null, created_at: '2026-10-02T08:00:00Z', entfernt_am: null, entfernt_von: null, entfernt_von_name: null }] : []);
  }
  if (p === '/rest/v1/tour_zusaetze') {
    if (m === 'POST') { const body = JSON.parse(req.postData()); const rows = Array.isArray(body) ? body : [body]; log.zusatzPosts.push(...rows); const neu = rows.map((x) => ({ ...Z(x.tour_id, x.kategorie, x.kennzeichen ?? null, x.betrag), anzahl: x.anzahl })); zusaetze.push(...neu); return json(obj ? neu[0] : neu, 201); }
    return json(zusaetze.filter((z) => !eqW('tour_id') || z.tour_id === eqW('tour_id')));
  }
  if (p === '/rest/v1/rechnungspositionen') {
    if (m === 'DELETE') { const rid = eqW('rechnung_id'); pos = pos.filter((x) => x.rechnung_id !== rid); return r.fulfill({ status: 204 }); }
    if (m === 'POST') { const body = JSON.parse(req.postData()); log.posPosts.push(...body); pos.push(...body.map((x) => ({ id: `n${Math.random()}`, ...x }))); return r.fulfill({ status: 201 }); }
    const rid = eqW('rechnung_id'); if (rid) return json(pos.filter((x) => x.rechnung_id === rid));
    const ids = inL('tour_id');
    return json(page(pos.filter((x) => !ids || ids.includes(x.tour_id)).map((x) => ({ ...x, rechnung: { id: x.rechnung_id, rechnungsnummer: rechnungen[x.rechnung_id]?.rechnungsnummer ?? 'Re_X', ist_auslagen_rechnung: false, datum: rechnungen[x.rechnung_id]?.datum ?? '2026-10-01' } }))));
  }
  if (p === '/rest/v1/rechnungen') {
    if (m === 'POST') { const body = JSON.parse(req.postData()); log.inserts.push(body); const row = { id: 'neu1', rechnungsnummer: 'Re_1099' }; return json(obj ? row : [row], 201); }
    const id = eqW('id');
    if (m === 'PATCH') { const body = JSON.parse(req.postData()); log.rePatches.push({ id, ...body }); Object.assign(rechnungen[id], body); return r.fulfill({ status: 204 }); }
    if (sp.get('ist_auslagen_rechnung') === 'eq.true') return json(page([]));
    if (id && rechnungen[id]) { const voll = { ...rechnungen[id], auftraggeber: agListe[0], rechnungsadresse: null }; return json(obj ? voll : [voll]); }
    return json(obj ? null : []);
  }
  if (p === '/rest/v1/rpc/next_rechnungsnummer') return json('Re_1099');
  if (p === '/rest/v1/touren') {
    const sel = sp.get('select') ?? '';
    if (sel.startsWith('kontakt') || sel === 'id') return json([]);
    let l = touren.map(mitZ);
    const ids = inL('id'); if (ids) l = l.filter((t) => ids.includes(t.id));
    const eq = eqW('id'); if (eq) l = l.filter((t) => t.id === eq);
    const ag = eqW('auftraggeber_id'); if (ag) l = l.filter((t) => t.auftraggeber_id === ag);
    const or = sp.get('or'); if (or) l = l.filter((t) => evalOr(t, or));
    return obj ? json(l[0] ?? null) : json(page(l));
  }
  return json(obj ? null : []);
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('pageerror', e.message));
const B = BASIS;

async function neuLaden(rid) {
  await pg.goto(`${B}/rechnungen/${rid}`);
  await pg.getByRole('heading', { name: 'Positionen' }).waitFor({ timeout: 15000 });
  await pg.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await pg.getByRole('button', { name: 'Touren erneut laden' }).click();
}
if (TEIL === 'alle' || TEIL === 'laden') {
  // Rechnung mit vorhandener Tour
  log.posPosts = [];
  await neuLaden('rVoll');
  await pg.getByRole('button', { name: 'Neu laden' }).click();
  await pg.getByRole('status').filter({ hasText: /hinzugefügt|aktualisiert|Keine/ }).waitFor({ timeout: 10000 });
  const info2 = await pg.getByRole('status').filter({ hasText: /hinzugefügt|aktualisiert|Keine/ }).innerText();
  pr('Vorhandene Rechnung: 2 Touren ergänzt + Position aktualisiert (Preis)', info2.startsWith('2 Touren hinzugefügt · 1 Position aktualisiert') && info2.includes('Preis'), info2);
  await pg.screenshot({ path: `${OUT}/rn_neuladen_${THEME}.png` });
  await pg.getByRole('button', { name: 'Abbrechen', exact: true }).first().click();  // nicht speichern
  // Leere Rechnung, Rechnungsdatum letzter Monat, Leistungszeitraum = Anlagetag
  await neuLaden('rLeer');
  await pg.getByRole('button', { name: 'Neu laden' }).click();
  await pg.getByText(/hinzugefügt|Keine passenden/).first().waitFor({ timeout: 10000 });
  const info = await pg.getByRole('status').filter({ hasText: /hinzugefügt|Keine passenden/ }).innerText();
  pr('Leere Rechnung (Datum letzter Monat): 2 Touren hinzugefügt (t2, t3 abweichendes Datum)', info.startsWith('2 Touren hinzugefügt'), info);
  await pg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await pg.waitForTimeout(1200);
  const neueTouren = [...new Set(log.posPosts.filter((x) => x.rechnung_id === 'rLeer').map((x) => x.tour_id))].sort();
  pr('Hinzugefügt: t2 + t3; nicht t1/t4 (andere Rechnung), t5 (anderer AG), t6 (anderes Datum)', JSON.stringify(neueTouren) === '["t2","t3"]', neueTouren);
  const patch = log.rePatches.find((x) => x.id === 'rLeer');
  pr('Rechnungsdatum/-nummer unverändert, Leistungszeitraum an Touren angepasst', patch && !('datum' in patch) && !('rechnungsnummer' in patch) && patch.leistungszeitraum_von === '2026-09-28' && patch.leistungszeitraum_bis === '2026-10-01', patch);
  // Keine passenden
  rechnungen.rLeer.datum = '2026-12-24';
  pos = pos.filter((x) => x.rechnung_id !== 'rLeer');
  await neuLaden('rLeer');
  await pg.getByRole('button', { name: 'Neu laden' }).click();
  const info3 = await pg.getByRole('status').filter({ hasText: /Keine passenden/ }).innerText({ timeout: 10000 });
  pr('Keine passenden Touren: mit Auftraggeber und Datum', info3.includes('Keine passenden neuen Touren gefunden (gesucht: Arval, Rechnungstag 24.12.2026'), info3);
  // Versendete Rechnung → Warnung
  await pg.goto(`${B}/rechnungen/rVers`);
  await pg.getByRole('heading', { name: 'Versand' }).waitFor({ timeout: 15000 });
  await pg.getByText(/Versendet \(App\) am/).first().waitFor({ timeout: 8000 });
  await pg.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await pg.getByRole('button', { name: 'Touren erneut laden' }).click();
  pr('Versendete Rechnung → Warnung', await pg.getByText(/Diese Rechnung wurde am 02\.10\.2026/).isVisible());
  await pg.getByRole('button', { name: 'Abbrechen' }).last().click();
}

if (TEIL === 'alle' || TEIL === 'pruefen') {
  // Entwurf: dezenter Hinweis, kein Dialog
  await pg.goto(`${B}/rechnungen/rPruef`);
  const badge = pg.getByTestId('auslagen-entwurf-hinweis');
  await badge.waitFor({ timeout: 15000 });
  pr('Entwurf: Badge „Auslagen: 3 Touren prüfen", kein Dialog', (await badge.innerText()).includes('Auslagen: 3 Touren prüfen') && (await pg.getByRole('dialog', { name: 'Auslagen prüfen' }).count()) === 0, await badge.innerText());
  await badge.click();
  const info = pg.getByRole('dialog', { name: 'Auslagen prüfen' });
  await info.waitFor({ timeout: 8000 });
  pr('Badge-Klick → Dialog zum Ansehen (nur „Schließen", kein Erstellen)', (await info.getByRole('button', { name: 'Schließen', exact: true }).count()) === 2 && (await info.getByRole('button', { name: /erstellen/ }).count()) === 0);
  await info.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
  const dlg = pg.getByRole('dialog', { name: 'Auslagen prüfen' });
  await dlg.waitFor({ timeout: 10000 });
  const zus = () => dlg.getByTestId('pruef-zusammenfassung').innerText();
  pr('Kopf: 3 von 3 Touren', (await zus()) === '3 von 3 Touren auf dieser Rechnung brauchen Prüfung', await zus());
  const karten = await dlg.locator('section[data-tour]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tour')));
  pr('Karten nach Tourdatum', JSON.stringify(karten) === '["pa","pb","pc"]', karten);
  pr('AB-Karte: nur ungeklärte Zeile', (await dlg.locator('section[data-tour="pa"] li').count()) === 1 && (await dlg.locator('section[data-tour="pa"] li[data-status="ungeklaert"]').innerText()).includes('HH-AB 1234'));
  const pb = dlg.locator('section[data-tour="pb"]');
  pr('ABA-Karte: Kopf mit Route + (ABA), Hin ✓ vorhanden, Rück ⚠ ungeklärt', (await pb.locator('h3').innerText()).includes('29.10. · Stuhr → Berlin → Stuhr (ABA)')
    && (await pb.locator('li[data-zeile="hin"]').innerText()).includes('Auslagen vorhanden') && (await pb.locator('li[data-zeile="rueck"]').innerText()).includes('Auslagen ungeklärt (Rück)'));
  const pc = dlg.locator('section[data-tour="pc"] li[data-zeile="fehlen"]');
  pr('Nicht auf Rechnung: rot, mit Zusätzen und Beträgen', (await pc.innerText()).includes('2 Zusätze nicht auf der Rechnung') && (await pc.innerText()).includes('Tankauslagen 54,20') && (await pc.innerText()).includes('Wäsche 15,00'), await pc.innerText());
  pr('Primär-Button: Trotzdem erstellen', await dlg.getByRole('button', { name: 'Trotzdem erstellen' }).isVisible());
  await pg.screenshot({ path: `${OUT}/rn_dialog_${THEME}${MOBIL ? '_mobil' : ''}.png` });
  await dlg.locator('section[data-tour="pa"]').getByRole('button', { name: /Keine Auslagen/ }).click();
  await dlg.locator('section[data-tour="pa"] li[data-erledigt]').waitFor({ timeout: 8000 });
  pr('Keine Auslagen → Zeile erledigt (✓, ausgegraut), Zähler sinkt', (await zus()).startsWith('2 von 3') && (await dlg.locator('section[data-tour="pa"]').getAttribute('data-problem')) === 'false', await zus());
  await dlg.locator('section[data-tour="pb"]').getByRole('button', { name: /Keine Auslagen/ }).click();
  await dlg.locator('section[data-tour="pb"] li[data-zeile="rueck"][data-erledigt]').waitFor({ timeout: 8000 });
  pr('Je Kennzeichen: nur Rück von pb', log.zusatzPosts.filter((x) => x.tour_id === 'pb').map((x) => x.kennzeichen).join() === 'B-CD 789');
  await dlg.locator('section[data-tour="pc"]').getByRole('button', { name: 'Zur Rechnung hinzufügen' }).click();
  await dlg.getByText('Alles geprüft').waitFor({ timeout: 8000 });
  pr('Alles erledigt → „Alles geprüft" + „Rechnung erstellen"', await dlg.getByRole('button', { name: 'Rechnung erstellen', exact: true }).isVisible());
  await pg.screenshot({ path: `${OUT}/rn_dialog_fertig_${THEME}${MOBIL ? '_mobil' : ''}.png` });
  log.rePatches = [];
  await dlg.getByRole('button', { name: 'Rechnung erstellen', exact: true }).click();
  await pg.waitForTimeout(800);
  pr('Rechnung erstellt (Status offen)', log.rePatches.some((x) => x.id === 'rPruef' && x.status === 'offen'), log.rePatches);
  // 20+ Touren → scrollbar, Buttons sichtbar
  await pg.goto(`${B}/rechnungen/rViel`);
  await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
  const d2 = pg.getByRole('dialog', { name: 'Auslagen prüfen' });
  await d2.waitFor({ timeout: 10000 });
  const inhalt = d2.getByTestId('pruef-inhalt');
  const scroll = await inhalt.evaluate((e) => e.scrollHeight > e.clientHeight + 50);
  const vh = pg.viewportSize().height;
  const btn = await d2.getByRole('button', { name: 'Trotzdem erstellen' }).boundingBox();
  pr('22 Touren: Inhalt scrollt, Fußzeile sichtbar', scroll && btn && btn.y + btn.height <= vh, { scroll, btn, vh });
  await inhalt.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const btn2 = await d2.getByRole('button', { name: 'Trotzdem erstellen' }).boundingBox();
  pr('Nach Scrollen: Kopf + Fuß weiter sichtbar', btn2 && btn2.y + btn2.height <= vh && (await d2.getByTestId('pruef-zusammenfassung').boundingBox()).y >= 0);
  await pg.screenshot({ path: `${OUT}/rn_dialog_lang_${THEME}${MOBIL ? '_mobil' : ''}.png` });
}

if (TEIL === 'alle' || TEIL === 'neu') {
  log.inserts = [];
  await pg.goto(`${B}/rechnungen/neu`);
  await pg.locator('#ag').selectOption(AG);
  await pg.locator('#rdat').fill('2026-10-01');
  await pg.getByRole('button', { name: 'Touren laden' }).click();
  await pg.getByText('T-2026-0302').first().waitFor({ timeout: 10000 }).catch(() => {});
  await pg.getByRole('button', { name: 'Als Entwurf speichern' }).click();
  await pg.waitForTimeout(1500);
  pr('Neue Rechnung: Entwurf speichern → kein Dialog, gespeichert', (await pg.getByRole('dialog', { name: 'Auslagen prüfen' }).count()) === 0 && log.inserts.length === 1 && log.inserts[0].status === 'entwurf', log.inserts.map((x) => x.status));
  log.inserts = [];
  await pg.goto(`${B}/rechnungen/neu`);
  await pg.locator('#ag').selectOption(AG);
  await pg.locator('#rdat').fill('2026-10-01');
  await pg.getByRole('button', { name: 'Touren laden' }).click();
  await pg.getByText('T-2026-0302').first().waitFor({ timeout: 10000 }).catch(() => {});
  await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
  await pg.getByRole('dialog', { name: 'Auslagen prüfen' }).waitFor({ timeout: 10000 });
  pr('Neue Rechnung: „Rechnung erstellen" → Dialog, noch nicht gespeichert', log.inserts.length === 0);
  await pg.getByRole('button', { name: 'Trotzdem erstellen' }).click();
  await pg.waitForTimeout(1200);
  pr('Trotzdem erstellen → Rechnung offen angelegt', log.inserts.length === 1 && log.inserts[0].status === 'offen');
}
await b.close();
console.log(f ? `${f} FEHLER` : 'alle ok'); process.exit(f ? 1 : 0);
