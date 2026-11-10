#!/usr/bin/env node
// E-Rechnung: Unit-Tests + Prüfung aller Testrechnungen mit dem
// KoSIT-Validator — lokal, offline, nur synthetische Daten.
//
//   npm run test:erechnung                  (Unit-Tests + Validator)
//   npm run test:erechnung -- --nur-unit    (ohne Validator)
//
// Voraussetzung für den Validator: Java ≥ 11 und einmalig
//   npm run erechnung:validator-einrichten
//
// Ergebnis: tools/erechnung/.ausgabe/ (XML-Dateien, Berichte, bericht.md)

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const AUS = join(HIER, '.ausgabe');
const VAL = join(HIER, '.validator');
const nurUnit = process.argv.includes('--nur-unit');

async function buendeln(eintrag, ziel) {
  await build({
    entryPoints: [join(HIER, eintrag)],
    outfile: join(AUS, ziel),
    bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
    external: ['pdfjs-dist'],
    // CommonJS-Abhängigkeiten (supabase-js) brauchen im ESM-Bündel ein require.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://stub.supabase.co', VITE_SUPABASE_ANON_KEY: 'stub' }) },
  });
  return pathToFileURL(join(AUS, ziel)).href;
}

rmSync(AUS, { recursive: true, force: true });
mkdirSync(join(AUS, 'xml'), { recursive: true });

// ---------------------------------------------------------------- 0. Typprüfung
console.log('0) Typprüfung (tools/erechnung + src/lib/erechnung)');
try {
  execFileSync(process.execPath, [join(HIER, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(HIER, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit' });
  console.log('  ok');
} catch {
  console.error('Typprüfung fehlgeschlagen.');
  process.exit(1);
}

// ---------------------------------------------------------------- 1. Unit-Tests
console.log('\n1) Unit-Tests');
await import(await buendeln('unit.test.ts', 'unit.test.mjs'));

// ---------------------------------------------------------------- 1b. Server-Tests (Archiv)
console.log('\n1b) Server-Tests Archiv (OneDrive/Supabase simuliert)');
await import(await buendeln('archiv.test.ts', 'archiv.test.mjs'));
const unitOk = !process.exitCode;
if (nurUnit) process.exit(process.exitCode ?? 0);

// ---------------------------------------------------------------- 2. Validator
console.log('\n2) KoSIT-Validator');
const offiziell = join(HIER, 'offiziell', 'scenarios.xml');
const szenarien = existsSync(offiziell) ? offiziell : join(VAL, 'repo', 'scenarios.xml');
const repo = existsSync(offiziell) ? join(HIER, 'offiziell') : join(VAL, 'repo');
if (!existsSync(join(VAL, 'validator.jar')) || !existsSync(szenarien)) {
  console.error('Validator nicht eingerichtet — bitte zuerst: npm run erechnung:validator-einrichten');
  process.exit(2);
}

const { erzeugeTestdateien } = await import(await buendeln('dateien.ts', 'dateien.mjs'));
const dateien = erzeugeTestdateien();
for (const d of dateien) writeFileSync(join(AUS, 'xml', `${d.name}.xml`), d.xml, 'utf8');

const berichte = join(AUS, 'berichte');
mkdirSync(berichte, { recursive: true });
try {
  execFileSync('java', ['-jar', join(VAL, 'validator.jar'), '-s', szenarien, '-r', repo, '-o', berichte,
    ...dateien.map((d) => join(AUS, 'xml', `${d.name}.xml`))], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  // Der Validator endet mit Code ≠ 0, sobald eine Datei abgelehnt wird — das
  // ist bei den Gegenproben gewollt. Ausgewertet wird unten je Bericht.
  if (!readdirSync(berichte).length) { console.error(String(e.stderr ?? e.message)); process.exit(3); }
}

const versionen = existsSync(join(VAL, 'versionen.json')) ? JSON.parse(readFileSync(join(VAL, 'versionen.json'), 'utf8')) : {};
const zeilen = [];
let abweichungen = 0;
for (const d of dateien) {
  const datei = readdirSync(berichte).find((f) => f.startsWith(`${d.name}-report`) && f.endsWith('.xml'));
  const xml = datei ? readFileSync(join(berichte, datei), 'utf8') : '';
  const gueltig = /<rep:report[^>]*valid="true"/.test(xml);
  const szenario = /<rep:scenario>([^<]*)</.exec(xml)?.[1] ?? '?';
  const meldungen = [...xml.matchAll(/<rep:message level="([^"]+)" id="([^"]*)"(?: location="[^"]*")?>([\s\S]*?)<\/rep:message>/g)]
    .map((m) => ({ stufe: m[1], id: m[2], text: m[3].replace(/\s+/g, ' ').trim() }));
  const fehler = meldungen.filter((m) => m.stufe === 'error');
  const warnungen = meldungen.filter((m) => m.stufe === 'warning');
  let passt = d.erwartung === 'gueltig' ? gueltig : !gueltig;
  if (passt && d.erwarteteRegeln) passt = d.erwarteteRegeln.every((r) => fehler.some((f) => f.id === r));
  if (!passt) abweichungen += 1;
  zeilen.push({ d, gueltig, szenario, fehler, warnungen, passt });
  const status = gueltig ? 'bestanden' : 'abgelehnt';
  console.log(`  ${passt ? 'ok  ' : 'FAIL'}  ${d.name.padEnd(36)} ${status.padEnd(10)} (${szenario}; erwartet: ${d.erwartung})`);
  for (const f of fehler) console.log(`          ${f.id}: ${f.text.slice(0, 160)}`);
  for (const w of warnungen) console.log(`          Warnung ${w.id}: ${w.text.slice(0, 160)}`);
}

// Bericht als Markdown
const md = [
  '# E-Rechnung — Validator-Bericht (Testrechnungen)', '',
  `Erstellt: ${new Date().toISOString()}  `,
  `Validator: KoSIT ${versionen.kosit ?? '?'}; Regeln: CEN EN 16931 ${versionen.cen ?? '?'}, XRechnung ${versionen.xrechnung ?? '?'}; Konfiguration: ${existsSync(offiziell) ? 'offiziell (tools/erechnung/offiziell)' : 'Nachbau (tools/erechnung/konfiguration)'}`, '',
  '| Testrechnung | Profil | Ergebnis | Erwartet | Fehler (Regel-ID) | Warnungen |',
  '|---|---|---|---|---|---|',
  ...zeilen.map((z) => `| ${z.d.name} — ${z.d.beschreibung} | ${z.szenario} | ${z.gueltig ? 'bestanden' : 'abgelehnt'} | ${z.d.erwartung}${z.passt ? '' : ' **ABWEICHUNG**'} | ${z.fehler.map((f) => f.id).join(', ') || '—'} | ${z.warnungen.map((w) => w.id).join(', ') || '—'} |`),
  '',
];
writeFileSync(join(AUS, 'bericht.md'), md.join('\n'), 'utf8');
console.log(`\nValidator: ${zeilen.length - abweichungen}/${zeilen.length} wie erwartet — Bericht: tools/erechnung/.ausgabe/bericht.md`);

// ---------------------------------------------------------------- 3. ZUGFeRD
console.log('\n3) ZUGFeRD: PDF/A-3b (veraPDF), eingebettetes XML (KoSIT), ganze Datei (Mustang)');
const veraJar = join(VAL, 'verapdf.jar'); const mustangJar = join(VAL, 'mustang.jar');
if (!existsSync(veraJar) || !existsSync(mustangJar)) {
  console.error('veraPDF/Mustang nicht eingerichtet — bitte: npm run erechnung:validator-einrichten');
  process.exit(2);
}
const java = (args) => { try { return execFileSync('java', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { return String(e.stdout ?? ''); } };
const { erzeugeZugferdDateien } = await import(await buendeln('zugferd.ts', 'zugferd.mjs'));
const zf = await erzeugeZugferdDateien(join(HIER, '..', '..'));
const zfDir = join(AUS, 'zugferd'); const zfXml = join(zfDir, 'xml'); const zfBer = join(zfDir, 'berichte');
mkdirSync(zfXml, { recursive: true }); mkdirSync(zfBer, { recursive: true });
for (const d of zf) {
  writeFileSync(join(zfDir, `${d.name}.pdf`), d.pdf);
  if (d.eingebettet != null) writeFileSync(join(zfXml, `${d.name}.xml`), d.eingebettet, 'utf8');
}
// veraPDF: alle Dateien in einem Lauf
const veraAus = java(['-cp', veraJar, 'org.verapdf.apps.GreenfieldCliWrapper', '--flavour', '3b', '--format', 'text', ...zf.map((d) => join(zfDir, `${d.name}.pdf`))]);
// KoSIT: die aus dem PDF gelesenen XML-Dateien
java(['-jar', join(VAL, 'validator.jar'), '-s', szenarien, '-r', repo, '-o', zfBer, ...zf.filter((d) => d.eingebettet != null).map((d) => join(zfXml, `${d.name}.xml`))]);
let zfFehler = 0;
const zfZeilen = [];
for (const d of zf) {
  const pfad = join(zfDir, `${d.name}.pdf`);
  const vera = new RegExp(`^PASS ${pfad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 3b`, 'm').test(veraAus);
  const rep = readdirSync(zfBer).find((f) => f.startsWith(`${d.name}-report`) && f.endsWith('.xml'));
  const repXml = rep ? readFileSync(join(zfBer, rep), 'utf8') : '';
  const kosit = /<rep:report[^>]*valid="true"/.test(repXml);
  const kositMeld = [...repXml.matchAll(/<rep:message level="([^"]+)" id="([^"]*)"/g)].filter((m) => m[1] !== 'information').map((m) => `${m[1]}:${m[2]}`);
  const mAus = java(['-jar', mustangJar, '--disable-file-logging', '--action', 'validate', '--source', pfad]);
  const mustang = /<summary status="valid"\/>\s*<\/validation>/.test(mAus);
  const mPdf = /<pdf>[\s\S]*?<summary status="valid"\/>[\s\S]*?<\/pdf>/.test(mAus);
  const mWarn = [...new Set([...mAus.matchAll(/<(warning|error)[^>]*>[\s\S]*?\[ID ([^\]]+)\]/g)].map((m) => `${m[1]}:${m[2]}`))];
  const identisch = d.eingebettet === d.xml;
  const okAlles = vera && kosit && mustang && mPdf && identisch && kositMeld.length === 0;
  if (!okAlles) zfFehler += 1;
  zfZeilen.push({ d, vera, kosit, kositMeld, mustang, mWarn, identisch, kb: Math.round(d.pdf.length / 1024) });
  console.log(`  ${okAlles ? 'ok  ' : 'FAIL'}  ${d.name.padEnd(26)} veraPDF ${vera ? 'bestanden' : 'FEHLER'} · KoSIT ${kosit ? 'bestanden' : 'FEHLER'} · Mustang ${mustang ? 'gültig' : 'UNGÜLTIG'}`
    + `${mWarn.length ? ` (${mWarn.join(', ')})` : ''} · XML ${identisch ? 'identisch' : 'ABWEICHEND'} · ${d.seiten} S. · ${Math.round(d.pdf.length / 1024)} KB`);
  for (const k of kositMeld) console.log(`          KoSIT ${k}`);
}
writeFileSync(join(AUS, 'bericht-zugferd.md'), [
  '# ZUGFeRD — Validator-Bericht (Testrechnungen)', '',
  `Erstellt: ${new Date().toISOString()}  `,
  `veraPDF ${versionen.verapdf ?? '?'} (Profil PDF/A-3b) · KoSIT ${versionen.kosit ?? '?'} mit CEN ${versionen.cen ?? '?'} · Mustang ${versionen.mustang ?? '?'}`, '',
  '| Testfall | Seiten | Größe | veraPDF PDF/A-3b | KoSIT (eingebettetes XML) | Mustang (ganze Datei) | Mustang-Meldungen | XML = erzeugtes XML |',
  '|---|---|---|---|---|---|---|---|',
  ...zfZeilen.map((z) => `| ${z.d.name} — ${z.d.beschreibung} | ${z.d.seiten} | ${z.kb} KB | ${z.vera ? 'bestanden' : '**FEHLER**'} | ${z.kosit ? 'bestanden' : '**FEHLER**'}${z.kositMeld.length ? ` (${z.kositMeld.join(', ')})` : ''} | ${z.mustang ? 'gültig' : '**UNGÜLTIG**'} | ${z.mWarn.join(', ') || '—'} | ${z.identisch ? 'ja' : '**NEIN**'} |`),
  '',
].join('\n'), 'utf8');
console.log(`\nZUGFeRD: ${zf.length - zfFehler}/${zf.length} bestanden — Bericht: tools/erechnung/.ausgabe/bericht-zugferd.md`);
process.exit(unitOk && abweichungen === 0 && zfFehler === 0 ? 0 : 1);
