// Server-Tests E-Rechnungs-Archiv (api/onedrive → server-lib/erechnungArchiv).
// OneDrive (Microsoft Graph) und Supabase sind durch einen fetch-Stub im
// Speicher ersetzt — es geht nichts nach außen. Ausführen: npm run test:erechnung
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AFRelationship, PDFDocument } from 'pdf-lib';
import handler from '../../api/onedrive';

process.env.AZURE_TENANT_ID = 't'; process.env.AZURE_CLIENT_ID = 'c'; process.env.AZURE_CLIENT_SECRET = 's';
process.env.ONEDRIVE_USER_EMAIL = 'drive@x.de';
process.env.SUPABASE_URL = 'https://sb.test'; process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'; process.env.VITE_SUPABASE_ANON_KEY = 'anon';

// ---------------------------------------------------------------- Stub
const drive = new Map<string, Uint8Array>();
const bucket = new Map<string, Uint8Array>();
const dokumente: Record<string, unknown>[] = [];
const geloescht: string[] = [];
const belege: Record<string, Record<string, unknown>> = {};
const R = (id: string, nr: string, format: string, status = 'offen') => { belege[id] = { id, rechnungsnummer: nr, datum: '2026-11-05', status, erechnung_format: format }; };
R('r1', 'Re_26/77', 'xrechnung_cii'); R('r2', 'Re_26/78', 'xrechnung_cii', 'entwurf'); R('r3', 'Re_26/79', 'pdf');
R('r4', 'Re_26/80', 'en16931_cii'); R('r5', 'Re_26/81', 'en16931_cii'); R('r6', 'Re_26/82', 'en16931_cii');
R('r7', 'Re_26/83', 'en16931_cii'); R('r8', 'Re_26/84', 'en16931_cii'); R('z1', 'Re_26/90', 'zugferd'); R('z2', 'Re_26/91', 'zugferd');
const fehler = { pdf: false, db: false, bucket: false };
const rolle = { wert: 'admin' };
const pfadAus = (u: URL) => decodeURIComponent(u.pathname.replace(/^.*\/drive\/root:\//, '').replace(/:\/content$/, '').replace(/:$/, ''));
const bytesVon = async (b: unknown): Promise<Uint8Array> => (b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b as ArrayBuffer));

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  const m = (init?.method ?? 'GET').toUpperCase();
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'login.microsoftonline.com') return json({ access_token: 'tok', expires_in: 3600 });
  if (u.hostname === 'graph.microsoft.com') {
    if (m === 'POST' && u.pathname.endsWith('/children')) return json({}, 201);
    const pfad = pfadAus(u);
    if (m === 'PUT') {
      if (fehler.pdf && pfad.endsWith('.pdf')) return new Response('kaputt', { status: 500 });
      const fail = u.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail';
      if (fail && drive.has(pfad)) return json({ error: 'nameAlreadyExists' }, 409);
      drive.set(pfad, await bytesVon(init!.body));
      return json({ id: pfad, name: pfad.split('/').pop() }, 201);
    }
    if (m === 'GET') {
      if (u.pathname.endsWith(':/content')) return drive.has(pfad) ? new Response(drive.get(pfad)! as BodyInit, { status: 200 }) : json({}, 404);
      return drive.has(pfad) ? json({ id: pfad, name: pfad.split('/').pop(), '@microsoft.graph.downloadUrl': `https://direkt.example/${encodeURIComponent(pfad)}?tempauth=x` }) : json({}, 404);
    }
    if (m === 'DELETE') { geloescht.push(pfad); drive.delete(pfad); return new Response(null, { status: 204 }); }
    if (m === 'PATCH') {
      const neu = JSON.parse(String(init!.body)).name as string;
      const ziel = pfad.slice(0, pfad.lastIndexOf('/') + 1) + neu;
      if (drive.has(ziel)) return json({}, 409);
      drive.set(ziel, drive.get(pfad)!); drive.delete(pfad); return json({ name: neu });
    }
  }
  if (u.hostname === 'sb.test') {
    const p = u.pathname;
    const eq = (k: string) => (u.searchParams.get(k) ?? '').replace(/^eq\./, '');
    if (p === '/auth/v1/user') return json({ id: 'u1', email: 'a@m.de', aud: 'authenticated' });
    if (p === '/rest/v1/app_users') return json(u.searchParams.get('select') === 'role' ? { role: rolle.wert } : { vorname: 'Ad', nachname: 'Min', email: 'a@m.de' });
    if (p === '/rest/v1/rechnungen') return json(belege[eq('id')] ?? null);
    if (p === '/rest/v1/erechnung_dokumente') {
      if (m === 'HEAD' || m === 'GET') {
        const n = dokumente.filter((d) => ['rechnung_id', 'xml_pfad', 'pdf_pfad'].every((k) => !u.searchParams.has(k) || d[k] === eq(k))).length;
        return new Response(m === 'HEAD' ? null : '[]', { status: 200, headers: { 'content-range': `*/${n}` } });
      }
      if (fehler.db) return json({ code: 'XX000', message: 'Datenbank nicht erreichbar' }, 500);
      const row = { id: `d${dokumente.length + 1}`, ...JSON.parse(String(init!.body)) };
      dokumente.push(row); return json(row, 201);
    }
    if (p.startsWith('/storage/v1/object/erechnung/')) {
      const k = decodeURIComponent(p.replace('/storage/v1/object/erechnung/', ''));
      if (m === 'POST') {
        if (fehler.bucket) return json({ error: 'Internal', message: 'Speicher nicht erreichbar', statusCode: '500' }, 500);
        if (bucket.has(k)) return json({ error: 'Duplicate', message: 'The resource already exists', statusCode: '409' }, 400);
        bucket.set(k, await bytesVon(init!.body)); return json({ Key: k });
      }
      if (m === 'GET') return bucket.has(k) ? new Response(bucket.get(k)! as BodyInit, { status: 200 }) : json({ message: 'not found' }, 404);
      if (m === 'DELETE') { geloescht.push(`bucket:${k}`); bucket.delete(k); return json([]); }
    }
    if (p === '/storage/v1/object/move' && m === 'POST') {
      const { sourceKey, destinationKey } = JSON.parse(String(init!.body));
      bucket.set(destinationKey, bucket.get(sourceKey)!); bucket.delete(sourceKey); return json({ message: 'ok' });
    }
    if (p === '/storage/v1/object/erechnung' && m === 'DELETE') { geloescht.push('bucket:*'); return json([]); }
  }
  throw new Error(`unerwartet: ${m} ${u}`);
}) as typeof fetch;

async function rufe(action: string, body: Record<string, unknown>) {
  let status = 0; let out: unknown = null;
  const res = { status(n: number) { status = n; return res; }, setHeader() {}, json(b: unknown) { out = b; }, end() {} };
  const fehlerLog = console.error; console.error = () => {};
  try { await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, query: { action }, body }, res); } finally { console.error = fehlerLog; }
  return { status, out: out as Record<string, unknown> };
}
const xmlText = (nr: string, typ = '380', extra = '') => `<?xml version="1.0"?><rsm:CrossIndustryInvoice><rsm:ExchangedDocument><ram:ID>${nr}</ram:ID><ram:TypeCode>${typ}</ram:TypeCode></rsm:ExchangedDocument>${extra}</rsm:CrossIndustryInvoice>`;
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64');
const xmlFuer = (nr: string, typ = '380', extra = '') => b64(xmlText(nr, typ, extra));
const PDF = b64('%PDF-1.7\n' + 'x'.repeat(200));
const PDF2 = b64('%PDF-1.7\n' + 'y'.repeat(200));
const sha = (x: string | Uint8Array) => createHash('sha256').update(typeof x === 'string' ? Buffer.from(x, 'base64') : x).digest('hex');
const A = 'Maja-Logistik/E-Rechnungen/2026/';
const txt = (p: string) => Buffer.from(drive.get(p)!).toString();
async function zugferdPdf(xml: string | null): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage();
  if (xml != null) await doc.attach(Buffer.from(xml), 'factur-x.xml', { mimeType: 'text/xml', afRelationship: AFRelationship.Alternative });
  return b64(await doc.save());
}

let f = 0; let ok = 0;
const pr = async (n: string, fn: () => Promise<void>) => { try { await fn(); ok += 1; console.log(`  ok    ${n}`); } catch (e) { f += 1; console.log(`  FAIL  ${n}\n        ${(e as Error).message}`); } };

await pr('Archivieren: XML + PDF in OneDrive, Kopie im Bucket, Eintrag mit SHA-256', async () => {
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r1', xml_base64: xmlFuer('Re_26/77'), pdf_base64: PDF });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(drive.has(`${A}Re_26_77.xml`) && drive.has(`${A}Re_26_77.pdf`) && bucket.has('2026/Re_26_77.xml'));
  const d = dokumente[0];
  assert.deepEqual([d.sha256_xml, d.sha256_pdf], [sha(xmlFuer('Re_26/77')), sha(PDF)]);
  assert.equal(sha(bucket.get('2026/Re_26_77.xml')!), d.sha256_xml, 'Bucket = gleicher Hash');
  assert.deepEqual([d.version, d.typ_code, d.format, d.belegnummer, d.erzeugt_von_name, d.protokoll], [1, '380', 'xrechnung_cii', 'Re_26/77', 'Ad Min', undefined]);
});
await pr('Schon archiviert → 409, niemals ersetzen, keine zweite Fassung', async () => {
  const vorher = [drive.get(`${A}Re_26_77.xml`), drive.get(`${A}Re_26_77.pdf`), drive.size, dokumente.length];
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r1', xml_base64: xmlFuer('Re_26/77', '380', '<x/>'), pdf_base64: PDF2 });
  assert.equal(r.status, 409);
  assert.match(String(r.out.error), /ERECHNUNG_BEREITS_ARCHIVIERT/);
  assert.deepEqual([drive.get(`${A}Re_26_77.xml`), drive.get(`${A}Re_26_77.pdf`), drive.size, dokumente.length], vorher);
});
await pr('Teilfehler PDF-Upload: XML bleibt liegen (kein Löschen); erneuter Versuch übernimmt es', async () => {
  fehler.pdf = true;
  let r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r4', xml_base64: xmlFuer('Re_26/80'), pdf_base64: PDF });
  fehler.pdf = false;
  assert.equal(r.status, 500);
  assert.ok(drive.has(`${A}Re_26_80.xml`) && !drive.has(`${A}Re_26_80.pdf`) && !dokumente.some((d) => d.rechnung_id === 'r4'));
  r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r4', xml_base64: xmlFuer('Re_26/80'), pdf_base64: PDF });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  const d = dokumente.find((x) => x.rechnung_id === 'r4')!;
  assert.match(String(d.protokoll), /Re_26_80\.xml: identische Datei aus einem früheren Versuch übernommen/);
  assert.equal(d.format, 'en16931_cii');
  assert.ok(![...drive.keys()].some((k) => k.includes('Re_26_80') && k.includes('verworfen')));
});
await pr('Teilfehler Archiv-Eintrag (Datenbank): Dateien liegen schon; erneuter Versuch gelingt ohne Überschreiben', async () => {
  fehler.db = true;
  let r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r5', xml_base64: xmlFuer('Re_26/81'), pdf_base64: PDF });
  fehler.db = false;
  assert.equal(r.status, 500);
  assert.match(String(r.out.error), /beim nächsten Versuch übernommen/);
  assert.ok(drive.has(`${A}Re_26_81.xml`) && drive.has(`${A}Re_26_81.pdf`) && bucket.has('2026/Re_26_81.xml'));
  const [x, p] = [drive.get(`${A}Re_26_81.xml`), drive.get(`${A}Re_26_81.pdf`)];
  r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r5', xml_base64: xmlFuer('Re_26/81'), pdf_base64: PDF });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(drive.get(`${A}Re_26_81.xml`), x); assert.equal(drive.get(`${A}Re_26_81.pdf`), p);
  assert.match(String(dokumente.find((d) => d.rechnung_id === 'r5')!.protokoll), /xml: identische Datei.*pdf: identische Datei.*Zweitablage.*identische Datei/);
});
await pr('Teilfehler Zweitablage (Supabase): erneuter Versuch gelingt', async () => {
  fehler.bucket = true;
  let r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r6', xml_base64: xmlFuer('Re_26/82'), pdf_base64: PDF });
  fehler.bucket = false;
  assert.equal(r.status, 500);
  r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r6', xml_base64: xmlFuer('Re_26/82'), pdf_base64: PDF });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(bucket.has('2026/Re_26_82.xml'));
});
await pr('Entwurf zwischenzeitlich geändert: verwaiste Dateien werden beiseitegelegt (…_verworfen_…), nichts überschrieben', async () => {
  fehler.db = true;
  await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r7', xml_base64: xmlFuer('Re_26/83'), pdf_base64: PDF });
  fehler.db = false;
  const altXml = txt(`${A}Re_26_83.xml`);
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r7', xml_base64: xmlFuer('Re_26/83', '380', '<geaendert/>'), pdf_base64: PDF2 });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  const verworfen = [...drive.keys()].filter((k) => /Re_26_83_verworfen_\d{8}-\d{6}\.(xml|pdf)$/.test(k));
  assert.equal(verworfen.length, 2, JSON.stringify([...drive.keys()]));
  assert.equal(txt(verworfen.find((k) => k.endsWith('.xml'))!), altXml, 'alter Inhalt unverändert beiseitegelegt');
  assert.ok(txt(`${A}Re_26_83.xml`).includes('<geaendert/>'));
  assert.ok([...bucket.keys()].some((k) => /Re_26_83_verworfen_.*\.xml$/.test(k)) && Buffer.from(bucket.get('2026/Re_26_83.xml')!).toString().includes('<geaendert/>'));
  const d = dokumente.find((x) => x.rechnung_id === 'r7')!;
  assert.match(String(d.protokoll), /nie gültig gewordene Datei aus einem früheren Versuch beiseitegelegt als Re_26_83_verworfen_/);
  assert.equal(d.sha256_xml, sha(xmlFuer('Re_26/83', '380', '<geaendert/>')));
});
await pr('Datei eines ANDEREN archivierten Belegs am Zielpfad → 409, wird nie beiseitegelegt', async () => {
  drive.set(`${A}Re_26_84.xml`, new Uint8Array([1, 2, 3]));
  dokumente.push({ id: 'fremd', rechnung_id: 'anderer', xml_pfad: `${A}Re_26_84.xml`, pdf_pfad: `${A}x.pdf` });
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r8', xml_base64: xmlFuer('Re_26/84'), pdf_base64: PDF });
  assert.equal(r.status, 409);
  assert.match(String(r.out.error), /gehört bereits zu einer archivierten E-Rechnung/);
  assert.deepEqual([...drive.get(`${A}Re_26_84.xml`)!], [1, 2, 3]);
  assert.ok(![...drive.keys()].some((k) => k.includes('Re_26_84_verworfen')));
});
await pr('Das Archiv löscht nie (kein DELETE an OneDrive oder Bucket in allen Fällen oben)', async () => {
  assert.deepEqual(geloescht, []);
});
await pr('ZUGFeRD: EINE Datei (PDF) in OneDrive + Bucket, XML-Hash aus dem eingebetteten XML', async () => {
  const xml = xmlText('Re_26/90');
  const pdf = await zugferdPdf(xml);
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'z1', pdf_base64: pdf });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  const d = dokumente.find((x) => x.rechnung_id === 'z1')!;
  assert.deepEqual([d.format, d.xml_pfad, d.pdf_pfad, d.bucket_pfad], ['zugferd', null, `${A}Re_26_90.pdf`, '2026/Re_26_90.pdf']);
  assert.equal(d.sha256_xml, createHash('sha256').update(xml).digest('hex'));
  assert.equal(d.sha256_pdf, sha(pdf));
  assert.ok(drive.has(`${A}Re_26_90.pdf`) && !drive.has(`${A}Re_26_90.xml`) && bucket.has('2026/Re_26_90.pdf'));
});
await pr('ZUGFeRD abgelehnt: ohne eingebettetes XML bzw. XML eines anderen Belegs', async () => {
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'z2', pdf_base64: await zugferdPdf(null) })).status, 400);
  const r = await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'z2', pdf_base64: await zugferdPdf(xmlText('Re_26/00')) });
  assert.equal(r.status, 400);
  assert.match(String(r.out.error), /gehört nicht zu diesem Beleg/);
  assert.ok(!drive.has(`${A}Re_26_91.pdf`));
});
await pr('Abgelehnt: falsches XML, Entwurf, PDF-Empfänger, keine PDF, Nicht-Admin', async () => {
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r8', xml_base64: xmlFuer('Re_26/99'), pdf_base64: PDF })).status, 400);
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r2', xml_base64: xmlFuer('Re_26/78'), pdf_base64: PDF })).status, 409);
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r3', xml_base64: xmlFuer('Re_26/79'), pdf_base64: PDF })).status, 409);
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r8', xml_base64: xmlFuer('Re_26/84'), pdf_base64: b64('nein') })).status, 400);
  rolle.wert = 'test';
  assert.equal((await rufe('erechnung-archivieren', { beleg: 'rechnung', id: 'r8', xml_base64: xmlFuer('Re_26/84'), pdf_base64: PDF })).status, 403);
  rolle.wert = 'admin';
});
await pr('Normaler Upload in das Archiv ist gesperrt', async () => {
  const r = await rufe('upload', { path: `${A}Re_26_77.xml`, contentType: 'application/xml', content_base64: 'eA==' });
  assert.equal(r.status, 403);
});
await pr('PDF neu generieren mit versionieren: alte Datei wird _v1, dann _v2', async () => {
  const pfad = 'Maja-Logistik/Rechnungen/2026/Re_26_5.pdf';
  await rufe('upload', { path: pfad, contentType: 'application/pdf', content_base64: b64('A'), versionieren: true });
  let r = await rufe('upload', { path: pfad, contentType: 'application/pdf', content_base64: b64('B'), versionieren: true });
  assert.equal(r.out.alteVersion, 'Re_26_5_v1.pdf');
  r = await rufe('upload', { path: pfad, contentType: 'application/pdf', content_base64: b64('C'), versionieren: true });
  assert.equal(r.out.alteVersion, 'Re_26_5_v2.pdf');
  assert.deepEqual([txt('Maja-Logistik/Rechnungen/2026/Re_26_5_v1.pdf'), txt('Maja-Logistik/Rechnungen/2026/Re_26_5_v2.pdf'), txt(pfad)], ['A', 'B', 'C']);
});
await pr('Upload ohne versionieren überschreibt wie bisher', async () => {
  const pfad = 'Maja-Logistik/Formulare/x.pdf';
  await rufe('upload', { path: pfad, contentType: 'application/pdf', content_base64: b64('A') });
  await rufe('upload', { path: pfad, contentType: 'application/pdf', content_base64: b64('B') });
  assert.equal(txt(pfad), 'B');
});
await pr('Export: Direkt-Links nur für Admin und nur für Archiv-Pfade', async () => {
  const r = await rufe('archiv-urls', { paths: [`${A}Re_26_77.xml`, `${A}Re_26_77.pdf`, `${A}gibt_es_nicht.xml`] });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  const urls = r.out.urls as Record<string, string | null>;
  assert.ok(urls[`${A}Re_26_77.xml`]!.startsWith('https://direkt.example/') && urls[`${A}Re_26_77.pdf`]);
  assert.equal(urls[`${A}gibt_es_nicht.xml`], null);
  assert.equal((await rufe('archiv-urls', { paths: ['Maja-Logistik/Rechnungen/2026/Re_26_5.pdf'] })).status, 400);
  assert.equal((await rufe('archiv-urls', { paths: [`${A}../x.xml`] })).status, 400);
  rolle.wert = 'fahrer';
  assert.equal((await rufe('archiv-urls', { paths: [`${A}Re_26_77.xml`] })).status, 403);
  rolle.wert = 'admin';
  assert.deepEqual(geloescht, [], 'der Export löscht nichts');
});
console.log(`Server-Tests (Archiv): ${ok}/${ok + f} bestanden`);
if (f) process.exitCode = 1;
