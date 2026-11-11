// Gemeinsame Testumgebung für die E-Rechnungs-Abläufe: Daten, Browser und
// ein Stub für Supabase, OneDrive-API und Mailversand. Der Stub bildet die
// Datenbank-Trigger (Snapshot, Fälligkeit, Sperre) so weit nach, wie die
// Oberfläche sie braucht; die echten Trigger prüfen die PostgreSQL-Tests.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pw, START, BASIS } from './basis.mjs';

export const UID = '00000000-0000-0000-0000-0000000000a1';

/** Zähler + Ausgabe für Prüfungen („  ok  " / „  FAIL"). */
export function pruefer() {
  const stand = { fehler: 0 };
  const pr = (n, c, i) => { if (c) console.log('  ok  ', n); else { stand.fehler++; console.log('  FAIL', n, i === undefined ? '' : JSON.stringify(i).slice(0, 600)); } };
  const ende = async (b) => { await b.close(); console.log(stand.fehler ? `${stand.fehler} FEHLER` : 'alle ok'); process.exit(stand.fehler ? 1 : 0); };
  return { pr, ende };
}

export async function erechnungUmgebung({ OUT, THEME = 'light', MOBIL = false }) {
  mkdirSync(`${OUT}/xml`, { recursive: true });
  /**
   * Eingriff in den Archiv-Aufruf (Fehlerpfad-Tests):
   *   haken.archiv = (anfrage) => null                      normal weiter
   *                              | { status, body }         Server antwortet mit Fehler
   *                              | { abbruch: true, speichern } Verbindung bricht ab (optional NACH dem Ablegen)
   *   haken.patch  = (rechnungId, änderung) => null | { status, body }   Änderung an der Rechnung schlägt fehl
   *   haken.patchGutschrift = (gutschriftId, änderung) => …               dasselbe für Gutschriften
   */
  const haken = { archiv: null, patch: null, patchGutschrift: null };
  // ---------------------------------------------------------------- Daten
  const FIRMA = {
    firmenname: 'Maja-Logistik M.Janßen', kurzname: 'Maja-Logistik', inhaber: 'M. Janßen', rechtsform: 'Einzelunternehmen',
    registergericht: null, registernummer: null, strasse: 'Heiligenroder Strasse 38e', plz: '28816', ort: 'Stuhr', land_code: 'DE',
    telefon: '+49 17641461645', email: 'info@maja-logistik.de', ust_id: 'DE309356726', steuernummer: '12/345/67890',
    kontakt_name: 'Test Kontakt', kontakt_telefon: '+49 17641461645', kontakt_email: 'buchhaltung@maja-logistik.de',
    elektronische_adresse: 'info@maja-logistik.de', iban: 'DE04280501000001429760', bic: 'SLZODE22XXX', bank: 'Testbank',
  };
  const settings = { firmendaten: { ...FIRMA }, rechnung_einstellungen: { standard_zahlungsziel_tage: 14 }, gutschrift_einstellungen: { dokumentbezeichnung: 'Gutschrift', nummernformat: 'GS-{Jahr}/{Nr}', summen_label: 'Gutschriftbetrag' } };
  const AG = {
    ag1: { id: 'ag1', name: 'EN-Kunde GmbH', kontakt: null, strasse: 'Weg 1', plz: '28195', ort: 'Bremen', email1: 'rechnung@en-kunde.example', email2: null, rechnungsformat: null,
      kundennummer: 'K-1', sachbearbeiter: null, kunden_uid: 'DE111111111', zahlungsziel_tage: 14, land_code: 'DE', erechnung_format: 'en16931_cii', erechnung_email: null, kaeufer_referenz: null,
      aba_aufschlag_prozent: null, externe_app_name: null, externe_app_url: null, preisliste_pdf_url: null },
    ag2: { id: 'ag2', name: 'XR-Kunde AG', kontakt: null, strasse: 'Weg 2', plz: '20095', ort: 'Hamburg', email1: 'x@xr.example', email2: null, rechnungsformat: null,
      kundennummer: 'K-2', sachbearbeiter: null, kunden_uid: 'DE222222222', zahlungsziel_tage: 30, land_code: 'DE', erechnung_format: 'xrechnung_cii', erechnung_email: 'eingang@xr.example', kaeufer_referenz: null,
      aba_aufschlag_prozent: null, externe_app_name: null, externe_app_url: null, preisliste_pdf_url: null },
    ag3: { id: 'ag3', name: 'PDF-Kunde KG', kontakt: null, strasse: 'Weg 3', plz: '26122', ort: 'Oldenburg', email1: 'p@pdf.example', email2: null, rechnungsformat: null,
      kundennummer: 'K-3', sachbearbeiter: null, kunden_uid: 'DE333333333', zahlungsziel_tage: 14, land_code: 'DE', erechnung_format: 'pdf', erechnung_email: null, kaeufer_referenz: null,
      aba_aufschlag_prozent: null, externe_app_name: null, externe_app_url: null, preisliste_pdf_url: null },
  };
  const basisR = (id, nr, ag, status, adr) => ({
    mit_unterschrift: false, mit_stempel: false, id, rechnungsnummer: nr, auftraggeber_id: ag, rechnungsadresse_id: null,
    datum: '2026-11-05', leistungszeitraum_von: '2026-10-01', leistungszeitraum_bis: '2026-10-31', anrede: 'Sehr geehrte Damen und Herren,',
    netto_summe: 650, ust_satz: 19, ust_betrag: 123.5, brutto_summe: 773.5, status, bezahlt_am: null, pdf_url: status === 'offen' ? `Maja-Logistik/Rechnungen/2026/${nr.replace('/', '_')}.pdf` : null,
    belege_pdf_url: null, email_versendet_am: null, notizen: null, ist_auslagen_rechnung: false, ansprechpartner: null, sachbearbeiter: 'Frau Kundin', kundennummer: AG[ag].kundennummer,
    rechnungsadresse_firma: AG[ag].name, rechnungsadresse_strasse: AG[ag].strasse, rechnungsadresse_plz_ort: `${adr[0]} ${adr[1]}`, rechnungsadresse_land: null,
    empfaenger_typ: 'auftraggeber', empfaenger_email: null, empfaenger_ust_id: null, rechnungsempfaenger_id: null, created_at: 'x', updated_at: 'x',
    faellig_am: null, zahlungsziel_tage: null, rechnungsadresse_plz: adr[0], rechnungsadresse_ort: adr[1], rechnungsadresse_land_code: 'DE',
    erechnung_format: null, erechnung_email: null, kaeufer_referenz: null, storniert_am: null, absender_snapshot: null,
  });
  const rechnungen = {
    r1: basisR('r1', 'Re_26/2001', 'ag1', 'entwurf', ['28195', 'Bremen']),
    r2: basisR('r2', 'Re_26/2002', 'ag2', 'entwurf', ['20095', 'Hamburg']),
    r3: basisR('r3', 'Re_26/2003', 'ag3', 'offen', ['26122', 'Oldenburg']),
  };
  const P = (id, r, nr, bez, preis, tour, ld) => ({ id, rechnung_id: r, position_nr: nr, bezeichnung: bez, unterzeilen: tour ? ['HB-XY 1'] : [], menge: 1, einzelpreis: preis, gesamtpreis: preis,
    tour_id: tour, zusatz_id: null, ist_manuell: !tour, ust_satz: null, created_at: 'x', einheit_code: null, steuerkategorie: null, befreiungsgrund_code: null, befreiungsgrund_text: null, leistungsdatum: ld });
  const positionen = [
    P('p1', 'r1', 1, 'Bremen nach München 13.10./15.10.26', 480, 't1', '2026-10-15'),
    P('p2', 'r1', 2, 'Bremen nach Hamburg 20.10.26', 150, 't2', '2026-10-20'),
    P('p3', 'r1', 3, 'Manuelle Position', 20, null, null),
    P('p4', 'r2', 1, 'Tour XR', 100, 't3', '2026-10-21'),
    P('p5', 'r3', 1, 'Tour PDF', 200, 't4', '2026-10-22'),
    P('p6', 'r3', 2, 'Wartezeit', 40, null, null),
  ];
  const gutschriften = {};
  const gpositionen = [];
  const dokumente = [];
  const log = { patchR: [], archiv: [], upload: [], mails: [], settingsUp: [], rpc: [], gsInsert: [], patchG: [] };

  // Stub der Datenbank-Trigger (Migration 115/116)
  function trigger(r, alt) {
    if (alt.status === 'entwurf' && r.status !== 'entwurf') {
      r.absender_snapshot = { ...settings.firmendaten };
      const ag = AG[r.auftraggeber_id];
      r.erechnung_format = ag.erechnung_format; r.erechnung_email = r.erechnung_email ?? ag.erechnung_email; r.kaeufer_referenz = r.kaeufer_referenz ?? ag.kaeufer_referenz;
      r.zahlungsziel_tage = r.zahlungsziel_tage ?? ag.zahlungsziel_tage;
      if (!r.faellig_am) { const d = new Date(`${r.datum}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + r.zahlungsziel_tage); r.faellig_am = d.toISOString().slice(0, 10); }
    }
  }
  const gesperrt = (id) => dokumente.some((d) => d.rechnung_id === id);

  const b = await pw.chromium.launch(START);
  const ctx = await b.newContext({ viewport: MOBIL ? { width: 390, height: 844 } : { width: 1300, height: 1000 }, isMobile: MOBIL });
  await ctx.addInitScript(([uid, theme]) => { localStorage.setItem('maja-theme', theme); localStorage.setItem('maja-logistik-auth', JSON.stringify({
    access_token: 'x.eyJzdWIiOiJhZG1pbiJ9.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' } })); }, [UID, THEME]);
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    const json = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    const body = () => { try { return JSON.parse(req.postData() ?? 'null'); } catch { return null; } };
    if (u.pathname.startsWith('/api/onedrive')) {
      const a = u.searchParams.get('action');
      if (a === 'erechnung-archivieren') {
        const x = body(); log.archiv.push(x);
        const eingriff = haken.archiv ? haken.archiv(x) : null;
        if (eingriff && !eingriff.abbruch) return json(eingriff.body, eingriff.status);
        // Ablegen wie der Server: ein Eintrag je Beleg, nie ersetzen.
        const ablegen = () => {
          const beleg = x.beleg === 'rechnung' ? rechnungen[x.id] : gutschriften[x.id];
          if (dokumente.some((d) => (x.beleg === 'rechnung' ? d.rechnung_id : d.gutschrift_id) === x.id)) return null;
          const xml = x.xml_base64 ? Buffer.from(x.xml_base64, 'base64') : null; // ZUGFeRD: kein separates XML
          const pdf = Buffer.from(x.pdf_base64, 'base64');
          const nr = xml ? /<rsm:ExchangedDocument>[\s\S]*?<ram:ID>([^<]*)</.exec(xml.toString())[1] : (x.beleg === 'rechnung' ? beleg.rechnungsnummer : beleg.gutschrift_nr);
          const typ = xml ? /<rsm:ExchangedDocument>[\s\S]*?<ram:TypeCode>([^<]*)</.exec(xml.toString())[1] : (x.beleg === 'rechnung' ? '380' : '381');
          const datei = nr.replace(/[^A-Za-z0-9]+/g, '_');
          if (xml) writeFileSync(`${OUT}/xml/${datei}.xml`, xml);
          writeFileSync(`${OUT}/xml/${datei}.pdf`, pdf);
          const hash = (buf) => createHash('sha256').update(buf).digest('hex');
          const d = { id: `d${dokumente.length + 1}`, rechnung_id: x.beleg === 'rechnung' ? x.id : null, gutschrift_id: x.beleg === 'gutschrift' ? x.id : null, version: 1, format: beleg.erechnung_format, typ_code: typ,
            belegnummer: nr, xml_pfad: xml ? `Maja-Logistik/E-Rechnungen/2026/${datei}.xml` : null, pdf_pfad: `Maja-Logistik/E-Rechnungen/2026/${datei}.pdf`, bucket_pfad: `2026/${datei}.${xml ? 'xml' : 'pdf'}`,
            sha256_xml: xml ? hash(xml) : null, sha256_pdf: hash(pdf), xml_bytes: xml ? xml.length : null, pdf_bytes: pdf.length, erzeugt_am: '2026-11-06T10:00:00Z', erzeugt_von: UID, erzeugt_von_name: 'Ad Min', protokoll: null };
          dokumente.push(d); return d;
        };
        if (eingriff?.abbruch) { if (eingriff.speichern) ablegen(); return r.abort('failed'); }
        const d = ablegen();
        if (!d) return json({ error: 'ERECHNUNG_BEREITS_ARCHIVIERT: Für diesen Beleg ist bereits eine E-Rechnung archiviert. Sie wird nicht ersetzt.' }, 409);
        return json({ ok: true, dokument: d });
      }
      if (a === 'upload') { const x = body(); log.upload.push({ path: x.path, versionieren: x.versionieren }); return json({ ok: true, path: x.path, alteVersion: x.versionieren ? 'Re_26_2003_v1.pdf' : null }); }
      return json({ ok: true });
    }
    if (u.pathname.startsWith('/api/emails')) { log.mails.push(body()); return json({ missing: [], attached: (body()?.attachments ?? []).length, versand_protokolliert: !!body()?.versand_beleg }); }
    if (u.hostname !== 'stub.supabase.co') return r.continue();
    const obj = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const p = u.pathname; const sp = u.searchParams; const m = req.method(); const sel = sp.get('select') ?? '';
    const eqW = (k) => (sp.getAll(k).find((x) => x.startsWith('eq.')) ?? '').slice(3);
    const one = (x) => (obj ? json(x ?? null) : json(x ? [x] : []));
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, aud: 'authenticated', role: 'authenticated', email: 'a@m.de' });
    if (p === '/rest/v1/app_users') return one({ id: UID, role: 'admin', email: 'a@m.de', vorname: 'Ad', nachname: 'Min', aktiv: true, auftraggeber_id: null });
    if (p === '/rest/v1/app_settings') {
      if (m === 'POST') { const x = body(); log.settingsUp.push(x); settings[x.key] = x.value; return json(x, 201); }
      const k = eqW('key'); return one(settings[k] ? { value: settings[k] } : null);
    }
    if (p === '/rest/v1/auftraggeber') { const id = eqW('id'); const l = Object.values(AG).filter((a) => !id || a.id === id).map((a) => ({ ...a, rechnungsadressen: [] })); return obj ? json(l[0]) : json(l); }
    if (p === '/rest/v1/rechnungen') {
      if (sel === 'faellig_am') return json([]);
      const id = eqW('id');
      if (m === 'PATCH') {
        const x = body(); log.patchR.push({ id, ...x }); const re = rechnungen[id]; const alt = { ...re };
        const eingriffP = haken.patch ? haken.patch(id, x) : null;
        if (eingriffP) return json(eingriffP.body, eingriffP.status);
        if (gesperrt(id) && Object.keys(x).some((k) => !['status', 'bezahlt_am', 'notizen', 'email_versendet_am'].includes(k))) {
          return json({ code: '42501', message: 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — Änderung nur über Storno/Teilgutschrift.' }, 403);
        }
        Object.assign(re, x); trigger(re, alt); return json([], 200);
      }
      if (m === 'POST') { const x = body(); const nid = `r${Object.keys(rechnungen).length + 1}`; rechnungen[nid] = { ...basisR(nid, 'Re_26/2099', x.auftraggeber_id ?? 'ag3', 'entwurf', ['1', 'x']), ...x, id: nid }; return obj ? json({ id: nid, rechnungsnummer: 'Re_26/2099' }, 201) : json([{ id: nid }], 201); }
      if (id) { const re = rechnungen[id]; return one(re ? { ...re, auftraggeber: AG[re.auftraggeber_id], rechnungsadresse: null } : null); }
      return json(Object.values(rechnungen).map((re) => ({ ...re, auftraggeber: AG[re.auftraggeber_id], rechnungsempfaenger: null, positionen_count: 1 })));
    }
    if (p === '/rest/v1/rechnungspositionen') {
      if (m === 'POST') { const x = body(); (Array.isArray(x) ? x : [x]).forEach((y, i) => positionen.push({ ...P(`pn${positionen.length + i}`, y.rechnung_id, y.position_nr, y.bezeichnung, y.einzelpreis, y.tour_id, null), ...y })); return json([], 201); }
      const rid = eqW('rechnung_id'); return json(positionen.filter((x) => !rid || x.rechnung_id === rid));
    }
    if (p === '/rest/v1/erechnung_dokumente') {
      const rid = eqW('rechnung_id'); const gid = eqW('gutschrift_id');
      return json(dokumente.filter((d) => (rid && d.rechnung_id === rid) || (gid && d.gutschrift_id === gid)));
    }
    if (p === '/rest/v1/rpc/rechnung_stornieren') {
      const { p_rechnung_id: rid } = body(); log.rpc.push(rid); const re = rechnungen[rid];
      const gid = `g${Object.keys(gutschriften).length + 1}`;
      gutschriften[gid] = { id: gid, gutschrift_nr: 'GS-2026/7', auftraggeber_id: re.auftraggeber_id, rechnungsempfaenger_id: null, rechnung_id: rid, datum: '2026-11-06',
        leistungszeitraum_von: re.leistungszeitraum_von, leistungszeitraum_bis: re.leistungszeitraum_bis, anrede: re.anrede,
        einleitungstext: `Hiermit stornieren wir die Rechnung ${re.rechnungsnummer} vom 05.11.2026 in voller Höhe.`, schlusstext: null, interne_notizen: null,
        adress_snapshot: { firma: re.rechnungsadresse_firma, ansprechpartner: null, strasse: re.rechnungsadresse_strasse, plz_ort: re.rechnungsadresse_plz_ort, land: null, plz: re.rechnungsadresse_plz, ort: re.rechnungsadresse_ort, land_code: 'DE' },
        kundennummer: re.kundennummer, sachbearbeiter: re.sachbearbeiter, ust_satz: 19, netto_summe: re.netto_summe, ust_summe: re.ust_betrag, brutto_summe: re.brutto_summe, status: 'final',
        pdf_url: null, email_versendet_am: null, created_at: 'x', updated_at: 'x', empfaenger_typ: 'auftraggeber', empfaenger_email: null, empfaenger_ust_id: null, mit_unterschrift: false, mit_stempel: false,
        absender_snapshot: { ...settings.firmendaten }, art: 'storno', bezug_rechnungsnummer: re.rechnungsnummer, bezug_rechnungsdatum: re.datum,
        erechnung_format: re.erechnung_format, erechnung_email: re.erechnung_email, kaeufer_referenz: re.kaeufer_referenz };
      for (const x of positionen.filter((y) => y.rechnung_id === rid)) gpositionen.push({ id: `gp${gpositionen.length}`, gutschrift_id: gid, position_nr: x.position_nr, bezeichnung: x.bezeichnung, unterzeilen: x.unterzeilen, menge: x.menge, einzelpreis: x.einzelpreis, gesamtpreis: x.gesamtpreis, ust_satz: null, tour_id: x.tour_id, ist_manuell: x.ist_manuell, created_at: 'x', leistungsdatum: x.leistungsdatum });
      re.status = 'storniert'; re.storniert_am = '2026-11-06T10:00:00Z';
      return json(gid);
    }
    if (p === '/rest/v1/gutschriften') {
      const id = eqW('id'); const rid = eqW('rechnung_id');
      if (m === 'POST') { const x = body(); log.gsInsert.push(x); const gid = `g${Object.keys(gutschriften).length + 1}`; gutschriften[gid] = { ...x, id: gid, gutschrift_nr: 'GS-2026/8', adress_snapshot: x.adress_snapshot, absender_snapshot: null, pdf_url: null, email_versendet_am: null, interne_notizen: null, schlusstext: null }; return obj ? json({ id: gid }, 201) : json([{ id: gid }], 201); }
      if (m === 'PATCH') {
        const x = body(); log.patchG.push({ id, ...x }); const g = gutschriften[id];
        const eingriffG = haken.patchGutschrift ? haken.patchGutschrift(id, x) : null;
        if (eingriffG) return json(eingriffG.body, eingriffG.status);
        if (dokumente.some((d) => d.gutschrift_id === id) && Object.keys(x).some((k) => !['interne_notizen', 'email_versendet_am', 'pdf_url'].includes(k))) {
          return json({ code: '42501', message: 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — Änderung nur über Storno/Teilgutschrift.' }, 403);
        }
        // Trigger gutschrift_final_snapshot (Migration 116)
        if (x.status === 'final' && g.status !== 'final') g.absender_snapshot = { ...settings.firmendaten };
        Object.assign(g, x); return json([], 200);
      }
      if (id) { const g = gutschriften[id]; return one(g ? { ...g, auftraggeber: AG[g.auftraggeber_id] ?? null, rechnung: rechnungen[g.rechnung_id] ? { id: g.rechnung_id, rechnungsnummer: rechnungen[g.rechnung_id].rechnungsnummer, datum: rechnungen[g.rechnung_id].datum } : null } : null); }
      return json(Object.values(gutschriften).filter((g) => !rid || g.rechnung_id === rid));
    }
    if (p === '/rest/v1/gutschriftspositionen') {
      if (m === 'POST') { const x = body(); const rows = (Array.isArray(x) ? x : [x]).map((y, i) => ({ ...y, id: `gpn${gpositionen.length + i}` })); gpositionen.push(...rows); return json(rows.map((y) => ({ id: y.id, position_nr: y.position_nr })), 201); }
      if (m === 'PATCH') return json([], 200);
      const gid = eqW('gutschrift_id'); return json(gpositionen.filter((x) => x.gutschrift_id === gid));
    }
    if (p.startsWith('/rest/v1/rpc/')) return json(null);
    return obj ? json(null) : json([]);
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('pageerror', e.message));
  pg.on('dialog', (d) => d.accept());
  const B = BASIS;
  const s = (name) => pg.screenshot({ path: `${OUT}/${name}_${THEME}${MOBIL ? '_mobil' : ''}.png`, fullPage: true });
  return { b, ctx, pg, B, s, AG, rechnungen, positionen, gutschriften, gpositionen, dokumente, log, settings, haken, basisR, P, FIRMA };
}
