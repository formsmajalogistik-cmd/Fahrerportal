// Browsertests (npm run test:e2e)
//
// Startet die App lokal mit einer Stub-Konfiguration (kein echtes Supabase,
// kein OneDrive, kein Mailversand — alle Aufrufe werden im Test abgefangen)
// und führt die Tests in tools/e2e/*.e2e.mjs nacheinander aus.
//
//   npm run test:e2e                 alle Tests
//   npm run test:e2e -- zugferd      nur Tests, deren Name „zugferd" enthält
//
// Ausgabe (Screenshots, abgefangene Dateien): tools/e2e/.ausgabe/
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const AUSGABE = resolve(HIER, '.ausgabe');
const PORT = Number(process.env.E2E_PORT ?? 5196);
const BASIS = `http://localhost:${PORT}`;

// [Datei, Bezeichnung, weitere Argumente (nach Ausgabeordner und Farbschema)]
const LAEUFE = [
  ['leerfahrt', 'Leerfahrt (Admin)', ['light', 'admin']],
  ['keine-auslagen', 'Zusatz „Keine Auslagen"', ['light']],
  ['rechnung-neu-laden', 'Touren neu laden + Prüfdialog', ['light']],
  ['erechnung-stammdaten', 'E-Rechnung: Stammdaten + Test-Export (mit Migration)', ['light', 'mit']],
  ['erechnung-stammdaten', 'E-Rechnung: Stammdaten (ohne Migration 115)', ['light', 'ohne']],
  ['erechnung-ablauf', 'E-Rechnung: Erstellen, Sperre, Versand, Storno, Teilgutschrift', ['light']],
  ['erechnung-ablauf', 'E-Rechnung: Ablauf mobil/dunkel', ['dark', 'mobil']],
  ['erechnung-fehlerpfad', 'E-Rechnung: Fehlerpfad beim Erstellen', ['light']],
  ['erechnung-zugferd', 'E-Rechnung: ZUGFeRD im App-Ablauf', ['light']],
  ['erechnung-zugferd', 'E-Rechnung: ZUGFeRD auf dem Handy (CPU gedrosselt)', ['light', 'mobil']],
  ['erechnung-export', 'E-Rechnung: Archiv-Export', ['light']],
];

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const laeufe = LAEUFE.filter(([datei, name]) => !filter.length || filter.some((f) => datei.includes(f) || name.includes(f)));
if (!laeufe.length) { console.error('Kein Test passt auf den Filter.'); process.exit(2); }

rmSync(AUSGABE, { recursive: true, force: true });
mkdirSync(AUSGABE, { recursive: true });

function starteApp() {
  const vite = spawn(process.execPath, [resolve(WURZEL, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: WURZEL,
    // Stub-Werte haben Vorrang vor einer evtl. vorhandenen .env.local —
    // die Tests sprechen NIE mit dem echten Supabase-Projekt.
    env: { ...process.env, VITE_SUPABASE_URL: 'https://stub.supabase.co', VITE_SUPABASE_ANON_KEY: 'stub-anon-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  vite.stdout.on('data', (d) => { log += d; });
  vite.stderr.on('data', (d) => { log += d; });
  return { vite, log: () => log };
}

async function warteAufApp(app) {
  for (let i = 0; i < 120; i++) {
    if (app.vite.exitCode != null) throw new Error(`App-Start fehlgeschlagen:\n${app.log()}`);
    try { if ((await fetch(BASIS)).ok) return; } catch { /* noch nicht bereit */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App antwortet nicht auf ${BASIS}:\n${app.log()}`);
}

function fuehreAus(datei, args, ordner) {
  return new Promise((fertig) => {
    mkdirSync(ordner, { recursive: true });
    const kind = spawn(process.execPath, [resolve(HIER, `${datei}.e2e.mjs`), ordner, ...args], {
      cwd: WURZEL, env: { ...process.env, E2E_BASIS: BASIS }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let aus = '';
    kind.stdout.on('data', (d) => { aus += d; });
    kind.stderr.on('data', (d) => { aus += d; });
    const zeit = setTimeout(() => { aus += '\n  FAIL Zeitüberschreitung (5 min)\n'; kind.kill('SIGKILL'); }, 300000);
    kind.on('close', (code) => { clearTimeout(zeit); fertig({ code, aus }); });
  });
}

const app = starteApp();
let fehler = 0;
let geprueft = 0;
let wackelig = 0;
try {
  await warteAufApp(app);
  for (const [datei, name, args] of laeufe) {
    const ordner = resolve(AUSGABE, `${datei}_${args.join('_')}`);
    let { code, aus } = await fuehreAus(datei, args, ordner);
    const zaehle = () => [(aus.match(/^ {2}ok /gm) ?? []).length, (aus.match(/^ {2}FAIL/gm) ?? []).length];
    let [ok, fail] = zaehle();
    let wiederholt = false;
    // Ein einziger zweiter Versuch (z.B. kalter Start der App) — wird in der
    // Ausgabe ausgewiesen, damit wackelige Tests nicht unbemerkt bleiben.
    if (code !== 0 || fail > 0) {
      const erster = aus;
      ({ code, aus } = await fuehreAus(datei, args, ordner));
      [ok, fail] = zaehle();
      wiederholt = true;
      if (code === 0 && fail === 0) aus = `--- 1. Versuch (fehlgeschlagen) ---\n${erster}\n--- 2. Versuch ---\n${aus}`;
    }
    geprueft += ok + fail;
    const bestanden = code === 0 && fail === 0;
    if (!bestanden) fehler++;
    if (bestanden && wiederholt) wackelig++;
    console.log(`${bestanden ? 'ok  ' : 'FAIL'}  ${name}  (${ok} Prüfungen${fail ? `, ${fail} fehlgeschlagen` : ''}${bestanden && wiederholt ? ', erst im 2. Versuch' : ''})`);
    if (!bestanden || wiederholt || process.argv.includes('--ausfuehrlich')) console.log(aus.replace(/^/gm, '      '));
  }
} catch (e) {
  fehler++;
  console.error(e instanceof Error ? e.message : e);
} finally {
  app.vite.kill();
}
console.log(`\nBrowsertests: ${laeufe.length - fehler}/${laeufe.length} Läufe bestanden, ${geprueft} Prüfungen${wackelig ? `, ${wackelig} erst im 2. Versuch` : ''} — Ausgabe: tools/e2e/.ausgabe/`);
process.exit(fehler ? 1 : 0);
