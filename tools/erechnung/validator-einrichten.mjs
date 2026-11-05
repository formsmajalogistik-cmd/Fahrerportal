#!/usr/bin/env node
// Richtet den KoSIT-Validator lokal ein (einmalig, danach offline).
//
//   npm run erechnung:validator-einrichten
//
// Lädt von Maven Central (Prüfsumme SHA-1 wird gegen Maven geprüft):
//   * KoSIT Validator 1.5.0 (standalone)          — de.kosit:validationtool
//   * CEN EN 16931 CII-Regeln (Schematron/XSLT)    — aus com.helger.phive.rules:phive-rules-en16931
//   * KoSIT XRechnung 3.0.2 CII-Regeln (XSLT)      — aus com.helger.phive.rules:phive-rules-xrechnung
//   * UN/CEFACT CII D16B XML-Schema               — aus com.helger.cii:ph-cii-d16b
// und baut daraus die Prüfkonfiguration (konfiguration/scenarios.xml).
//
// Es werden KEINE Rechnungsdaten übertragen — nur diese Programmdateien
// werden heruntergeladen. Geprüft wird anschließend rein lokal.
//
// Ohne Internet / bei Sperre: Dateien manuell nach
// tools/erechnung/.validator/download/ legen (Dateinamen siehe unten).
// Offizielle KoSIT-Konfiguration statt Nachbau: Inhalt des ZIPs
// „validator-configuration-xrechnung_*.zip" nach tools/erechnung/offiziell/
// entpacken (dort muss scenarios.xml liegen).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIEL = join(HIER, '.validator');
const DOWNLOAD = join(ZIEL, 'download');
const REPO = join(ZIEL, 'repo');

const MAVEN = (process.env.MAVEN_MIRROR ?? 'https://repo1.maven.org/maven2').replace(/\/$/, '');
const SPIEGEL = 'https://maven-central.storage-download.googleapis.com/maven2';

export const VERSIONEN = {
  kosit: '1.5.0',
  phive: '4.6.4',
  cen: '1.3.15',
  xrechnung: '3.0.2',
  cii: '10.1.0',
};

const ARTEFAKTE = [
  { datei: `validationtool-${VERSIONEN.kosit}-standalone.jar`, pfad: `de/kosit/validationtool/${VERSIONEN.kosit}` },
  { datei: `phive-rules-en16931-${VERSIONEN.phive}.jar`, pfad: `com/helger/phive/rules/phive-rules-en16931/${VERSIONEN.phive}` },
  { datei: `phive-rules-xrechnung-${VERSIONEN.phive}.jar`, pfad: `com/helger/phive/rules/phive-rules-xrechnung/${VERSIONEN.phive}` },
  { datei: `ph-cii-d16b-${VERSIONEN.cii}.jar`, pfad: `com/helger/cii/ph-cii-d16b/${VERSIONEN.cii}` },
];

function laden(url, ziel) {
  try {
    execFileSync('curl', ['-sSfL', '--retry', '3', '-m', '300', '-o', ziel, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (e) {
    console.warn(`  ! ${url}: ${String(e.stderr ?? e.message).trim()}`);
    return false;
  }
}

function sha1(datei) { return createHash('sha1').update(readFileSync(datei)).digest('hex'); }

function holen({ datei, pfad }) {
  const ziel = join(DOWNLOAD, datei);
  const quellen = [MAVEN, SPIEGEL].filter((v, i, a) => a.indexOf(v) === i);
  for (const basis of quellen) {
    const pruef = join(DOWNLOAD, `${datei}.sha1`);
    if (!existsSync(ziel) && !laden(`${basis}/${pfad}/${datei}`, ziel)) continue;
    if (!existsSync(pruef) && !laden(`${basis}/${pfad}/${datei}.sha1`, pruef)) continue;
    const soll = readFileSync(pruef, 'utf8').trim().split(/\s+/)[0];
    const ist = sha1(ziel);
    if (soll === ist) { console.log(`  ✓ ${datei} (SHA-1 ${ist.slice(0, 12)}…)`); return ziel; }
    console.warn(`  ! ${datei}: Prüfsumme falsch (${ist} ≠ ${soll}) — lade neu`);
    rmSync(ziel, { force: true }); rmSync(pruef, { force: true });
  }
  if (existsSync(ziel)) {
    console.warn(`  ? ${datei}: liegt vor, Prüfsumme konnte nicht geladen werden — wird verwendet`);
    return ziel;
  }
  throw new Error(`${datei} konnte nicht geladen werden. Bitte manuell nach ${DOWNLOAD} legen.`);
}

/** Minimaler ZIP-Leser (Central Directory, deflate/stored). */
function zipEintraege(datei) {
  const b = readFileSync(datei);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i -= 1) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${datei}: kein ZIP`);
  const anzahl = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const liste = new Map();
  for (let n = 0; n < anzahl; n += 1) {
    const methode = b.readUInt16LE(p + 10);
    const groesse = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const kommLen = b.readUInt16LE(p + 32);
    const lokal = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    liste.set(name, () => {
      const lNameLen = b.readUInt16LE(lokal + 26);
      const lExtraLen = b.readUInt16LE(lokal + 28);
      const start = lokal + 30 + lNameLen + lExtraLen;
      const roh = b.subarray(start, start + groesse);
      return methode === 0 ? Buffer.from(roh) : inflateRawSync(roh);
    });
    p += 46 + nameLen + extraLen + kommLen;
  }
  return liste;
}

function entpacken(jar, praefix, zielOrdner, umbenennen = (n) => n) {
  let n = 0;
  for (const [name, lesen] of zipEintraege(jar)) {
    if (!name.startsWith(praefix) || name.endsWith('/')) continue;
    const ziel = join(zielOrdner, umbenennen(name.slice(praefix.length)));
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, lesen());
    n += 1;
  }
  if (n === 0) throw new Error(`${jar}: nichts unter ${praefix} gefunden`);
  return n;
}

function main() {
  console.log('E-Rechnung: Validator einrichten');
  mkdirSync(DOWNLOAD, { recursive: true });
  const [kosit, en, xr, cii] = ARTEFAKTE.map(holen);

  rmSync(REPO, { recursive: true, force: true });
  const res = join(REPO, 'resources');
  console.log('  Regeln entpacken …');
  entpacken(en, `external/schematron/${VERSIONEN.cen}/cii/`, join(res, 'en16931'));
  entpacken(xr, `external/schematron/${VERSIONEN.xrechnung}/`, join(res, 'xrechnung'));
  const nXsd = entpacken(cii, 'external/schemas/d16b/', join(res, 'cii', 'd16b'));
  copyFileSync(join(HIER, 'konfiguration', 'report.xsl'), join(res, 'report.xsl'));
  copyFileSync(join(HIER, 'konfiguration', 'scenarios.xml'), join(REPO, 'scenarios.xml'));
  copyFileSync(kosit, join(ZIEL, 'validator.jar'));
  for (const f of ['en16931/EN16931-CII-validation.xslt', 'xrechnung/XRechnung-CII-validation.xslt',
    'cii/d16b/data/standard/CrossIndustryInvoice_100pD16B.xsd']) {
    if (!existsSync(join(res, f))) throw new Error(`Fehlt nach dem Entpacken: ${f}`);
  }
  writeFileSync(join(ZIEL, 'versionen.json'), JSON.stringify({ ...VERSIONEN, eingerichtet: new Date().toISOString() }, null, 2));
  console.log(`  ✓ ${nXsd} Schema-Dateien, CEN ${VERSIONEN.cen}, XRechnung ${VERSIONEN.xrechnung}, KoSIT ${VERSIONEN.kosit}`);
  console.log(`Fertig: ${ZIEL}`);
  if (existsSync(join(HIER, 'offiziell', 'scenarios.xml'))) {
    console.log('Hinweis: tools/erechnung/offiziell/scenarios.xml gefunden — die Prüfung verwendet die offizielle Konfiguration.');
  }
}

try { main(); } catch (e) { console.error(`FEHLER: ${e.message}`); process.exit(1); }
