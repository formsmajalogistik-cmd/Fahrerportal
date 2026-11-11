// Gemeinsame Basis der Browsertests: Playwright finden, Browser starten.
//
// Playwright ist bewusst KEINE Abhängigkeit des Projekts (die App braucht
// es nicht). Gesucht wird in dieser Reihenfolge:
//   1. E2E_PLAYWRIGHT=/pfad/zu/node_modules/playwright
//   2. lokal installiertes „playwright"
//   3. global installiertes („npm i -g playwright")
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

function ladePlaywright() {
  const kandidaten = [process.env.E2E_PLAYWRIGHT, 'playwright'];
  try { kandidaten.push(`${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright`); } catch { /* ohne npm */ }
  for (const k of kandidaten) {
    if (!k) continue;
    try { return require(k); } catch { /* nächster */ }
  }
  throw new Error('Playwright nicht gefunden. Einmalig: „npm i -g playwright && npx playwright install chromium" '
    + '— oder E2E_PLAYWRIGHT=/pfad/zu/node_modules/playwright setzen.');
}

export const pw = ladePlaywright();

/** Vorinstalliertes Chromium nutzen, falls vorhanden (E2E_CHROMIUM überschreibt). */
const chromium = process.env.E2E_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
export const START = chromium ? { executablePath: chromium } : {};

/** Adresse der laufenden App (lauf.mjs startet sie und setzt E2E_BASIS). */
export const BASIS = process.env.E2E_BASIS ?? 'http://localhost:5196';
