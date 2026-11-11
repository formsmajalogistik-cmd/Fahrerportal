#!/usr/bin/env node
// Prüft vorhandene ZUGFeRD-Dateien lokal und offline — z.B. Dateien, die im
// Browsertest aus dem echten App-Ablauf abgefangen wurden, oder den
// Test-Export aus den Einstellungen:
//
//   npm run erechnung:pruefe-zugferd -- datei1.pdf [datei2.pdf …]
//
//   1. veraPDF   — PDF/A-3b
//   2. KoSIT     — das aus dem PDF gelesene XML (EN 16931)
//   3. Mustang   — die ganze Datei (PDF + XML)
//
// Voraussetzung: Java ≥ 11 und einmalig „npm run erechnung:validator-einrichten".
// Es werden keine Daten an Dritte gesendet.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const VAL = join(HIER, '.validator');
const AUS = join(HIER, '.ausgabe-pruefung');
const dateien = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((d) => resolve(d));
if (!dateien.length) { console.error('Aufruf: npm run erechnung:pruefe-zugferd -- datei.pdf [weitere.pdf …]'); process.exit(2); }
for (const jar of ['validator.jar', 'verapdf.jar', 'mustang.jar']) {
  if (!existsSync(join(VAL, jar))) { console.error('Validatoren nicht eingerichtet — bitte: npm run erechnung:validator-einrichten'); process.exit(2); }
}
const fehlt = dateien.filter((d) => !existsSync(d));
if (fehlt.length) { console.error(`Datei nicht gefunden: ${fehlt.join(', ')}`); process.exit(2); }

rmSync(AUS, { recursive: true, force: true });
mkdirSync(join(AUS, 'xml'), { recursive: true }); mkdirSync(join(AUS, 'berichte'), { recursive: true });
await build({
  entryPoints: [join(HIER, '..', '..', 'src', 'lib', 'erechnung', 'zugferd.ts')], outfile: join(AUS, 'zugferd.mjs'),
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
});
const { leseZugferdXml } = await import(pathToFileURL(join(AUS, 'zugferd.mjs')).href);

const offiziell = join(HIER, 'offiziell', 'scenarios.xml');
const szenarien = existsSync(offiziell) ? offiziell : join(VAL, 'repo', 'scenarios.xml');
const repo = existsSync(offiziell) ? join(HIER, 'offiziell') : join(VAL, 'repo');
const java = (args) => { try { return execFileSync('java', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { return String(e.stdout ?? ''); } };

// Eindeutige Arbeitsnamen (gleiche Dateinamen aus verschiedenen Ordnern möglich).
const faelle = [];
for (const [i, pfad] of dateien.entries()) {
  const name = `${String(i + 1).padStart(2, '0')}_${basename(pfad, '.pdf').replace(/[^A-Za-z0-9._-]+/g, '_')}`;
  const pdf = new Uint8Array(readFileSync(pfad));
  const xml = await leseZugferdXml(pdf).catch(() => null);
  if (xml != null) writeFileSync(join(AUS, 'xml', `${name}.xml`), xml, 'utf8');
  faelle.push({ pfad, name, xml, kb: Math.round(pdf.length / 1024) });
}

const veraAus = java(['-cp', join(VAL, 'verapdf.jar'), 'org.verapdf.apps.GreenfieldCliWrapper', '--flavour', '3b', '--format', 'text', ...dateien]);
const mitXml = faelle.filter((f) => f.xml != null);
if (mitXml.length) java(['-jar', join(VAL, 'validator.jar'), '-s', szenarien, '-r', repo, '-o', join(AUS, 'berichte'), ...mitXml.map((f) => join(AUS, 'xml', `${f.name}.xml`))]);

let fehler = 0;
const ergebnis = [];
for (const f of faelle) {
  const vera = new RegExp(`^PASS ${f.pfad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 3b`, 'm').test(veraAus);
  const veraZeile = veraAus.split('\n').find((z) => z.includes(f.pfad)) ?? '';
  const rep = readdirSync(join(AUS, 'berichte')).find((d) => d.startsWith(`${f.name}-report`) && d.endsWith('.xml'));
  const repXml = rep ? readFileSync(join(AUS, 'berichte', rep), 'utf8') : '';
  const kosit = f.xml != null && /<rep:report[^>]*valid="true"/.test(repXml);
  const kositMeld = [...repXml.matchAll(/<rep:message level="([^"]+)" id="([^"]*)"/g)].filter((m) => m[1] !== 'information').map((m) => `${m[1]}:${m[2]}`);
  const mAus = java(['-jar', join(VAL, 'mustang.jar'), '--disable-file-logging', '--action', 'validate', '--source', f.pfad]);
  const mustang = /<summary status="valid"\/>\s*<\/validation>/.test(mAus);
  const mMeld = [...new Set([...mAus.matchAll(/<(warning|error)[^>]*>[\s\S]*?\[ID ([^\]]+)\]/g)].map((m) => `${m[1]}:${m[2]}`))];
  const typ = f.xml ? (/<ram:TypeCode>([^<]*)</.exec(f.xml)?.[1] ?? '?') : '—';
  const nr = f.xml ? (/<rsm:ExchangedDocument>[\s\S]*?<ram:ID>([^<]*)</.exec(f.xml)?.[1] ?? '?') : '—';
  const ok = vera && kosit && mustang && kositMeld.length === 0;
  if (!ok) fehler++;
  ergebnis.push({ datei: f.pfad, belegnummer: nr, typ, kb: f.kb, verapdf: vera, kosit, kositMeldungen: kositMeld, mustang, mustangMeldungen: mMeld });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${basename(f.pfad).padEnd(28)} ${nr} (Typ ${typ}) · ${f.kb} KB · veraPDF ${vera ? 'bestanden' : `FEHLER ${veraZeile}`} · `
    + `KoSIT ${f.xml == null ? 'KEIN XML IM PDF' : kosit ? 'bestanden' : 'FEHLER'}${kositMeld.length ? ` (${kositMeld.join(', ')})` : ''} · `
    + `Mustang ${mustang ? 'gültig' : 'UNGÜLTIG'}${mMeld.length ? ` (${mMeld.join(', ')})` : ''}`);
}
writeFileSync(join(AUS, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2), 'utf8');
console.log(`\n${faelle.length - fehler}/${faelle.length} bestanden — Einzelberichte: tools/erechnung/.ausgabe-pruefung/`);
process.exit(fehler ? 1 : 0);
