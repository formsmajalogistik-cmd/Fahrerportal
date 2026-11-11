// Fehlerpfad beim Erstellen einer E-Rechnung (Phase 1c, Teil A Punkt 2):
// Was sieht der Nutzer, wenn die Ablage scheitert — und funktioniert der
// erneute Versuch, ohne dass etwas überschrieben oder doppelt abgelegt wird?
// (Das Verhalten des Servers selbst prüfen die Server-Tests in
// tools/erechnung/archiv.test.ts, die Rechnungsnummer die PostgreSQL-Tests.)
import { erechnungUmgebung, pruefer } from './erechnung-umgebung.mjs';

const OUT = process.argv[2]; const THEME = process.argv[3] ?? 'light';
const { pr, ende } = pruefer();
const { b, pg, B, s, AG, rechnungen, positionen, gutschriften, dokumente, log, haken, basisR, P, settings } = await erechnungUmgebung({ OUT, THEME });
// Die App wiederholt Serverfehler (5xx) und Netzabbrüche von sich aus. „dauerhaft"
// lässt deshalb JEDEN Versuch scheitern, „einmal" nur den ersten.
const dauerhaft = (antwort) => () => antwort;
const einmal = (antwort) => () => { haken.archiv = null; return antwort; };
const dokVon = (id) => dokumente.filter((d) => d.rechnung_id === id);
const alarm = () => pg.getByRole('alert').filter({ hasText: 'Was ist passiert' });

// ---- 1) Ablage scheitert (Server meldet Fehler) → Entwurf, Nummer bleibt → erneut versuchen
await pg.goto(`${B}/rechnungen/r1`);
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 30000 });
haken.archiv = dauerhaft({ status: 502, body: { error: 'OneDrive nicht erreichbar (Zeitüberschreitung beim Hochladen)' } });
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await alarm().waitFor({ timeout: 30000 });
const m1 = await alarm().innerText();
pr('Meldung: was ist passiert + Grund + was ist zu tun', m1.includes('Was ist passiert: Die E-Rechnung konnte nicht abgelegt werden (OneDrive nicht erreichbar')
  && m1.includes('Die Rechnung ist wieder ein Entwurf und behält ihre Nummer') && m1.includes('Was tun: „Rechnung erstellen" erneut versuchen') && m1.includes('nichts wird überschrieben'), m1);
pr('Rechnung wieder Entwurf, Nummer unverändert, Fälligkeit/Snapshot geleert', rechnungen.r1.status === 'entwurf' && rechnungen.r1.rechnungsnummer === 'Re_26/2001'
  && rechnungen.r1.faellig_am === null && rechnungen.r1.absender_snapshot === null, rechnungen.r1);
pr('Kein Archiv-Eintrag entstanden, keine Sperre', dokVon('r1').length === 0 && (await pg.getByTestId('sperr-hinweis').count()) === 0);
pr('Oberfläche zeigt wieder den Entwurf mit „Rechnung erstellen"', await pg.getByRole('button', { name: 'Rechnung erstellen' }).isEnabled());
await s('fehlerpfad_meldung');
const gescheitert = log.archiv.filter((x) => x.id === 'r1').length;
haken.archiv = null; // Störung behoben
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 30000 });
pr('Erneuter Versuch: erstellt, dieselbe Nummer, genau EIN Archiv-Eintrag', rechnungen.r1.status === 'offen' && rechnungen.r1.rechnungsnummer === 'Re_26/2001' && dokVon('r1').length === 1
  && dokVon('r1')[0].belegnummer === 'Re_26/2001', dokVon('r1'));
pr(`Automatische Wiederholung (${gescheitert} gescheiterte Aufrufe), danach 1 erfolgreicher; Statusfolge offen → Entwurf → offen`, gescheitert >= 2 && log.archiv.filter((x) => x.id === 'r1').length === gescheitert + 1
  && log.patchR.filter((x) => x.id === 'r1' && x.status).map((x) => x.status).join() === 'offen,entwurf,offen', log.patchR);

// ---- 2) Datei abgelegt, aber die Antwort geht verloren → gilt als erzeugt, kein zweiter Eintrag
AG.ag2.kaeufer_referenz = 'LW-4711-99';
await pg.goto(`${B}/rechnungen/r2`);
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 30000 });
haken.archiv = einmal({ abbruch: true, speichern: true });
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 60000 });
pr('Antwort verloren: Rechnung bleibt erstellt (nicht zurück auf Entwurf)', rechnungen.r2.status === 'offen' && !log.patchR.some((x) => x.id === 'r2' && x.status === 'entwurf'), log.patchR.filter((x) => x.id === 'r2'));
pr('Antwort verloren: automatische Wiederholung trifft auf den vorhandenen Eintrag — genau EIN Archiv-Eintrag, keine Fehlermeldung',
  dokVon('r2').length === 1 && log.archiv.filter((x) => x.id === 'r2').length >= 2 && (await alarm().count()) === 0, [dokVon('r2').length, log.archiv.filter((x) => x.id === 'r2').length]);
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 10000 });

// ---- 3) Ablage scheitert UND Zurücksetzen scheitert → „offen ohne E-Rechnung" → nachholen
rechnungen.rf = basisR('rf', 'Re_26/2020', 'ag1', 'entwurf', ['28195', 'Bremen']);
positionen.push(P('pf1', 'rf', 1, 'Tour Bremen nach Kiel 22.10.26', 300, 'tf1', '2026-10-22'));
await pg.goto(`${B}/rechnungen/rf`);
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 30000 });
haken.archiv = dauerhaft({ status: 500, body: { error: 'Speicher nicht erreichbar' } });
haken.patch = (id, x) => (id === 'rf' && x.status === 'entwurf' ? { status: 500, body: { message: 'Verbindung zur Datenbank unterbrochen' } } : null);
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await alarm().waitFor({ timeout: 30000 });
const m3 = await alarm().innerText();
pr('Meldung nennt beide Fehler und den Ausweg „E-Rechnung erzeugen"', m3.includes('Speicher nicht erreichbar') && m3.includes('ließ sich auch nicht auf „Entwurf" zurücksetzen') && m3.includes('„E-Rechnung erzeugen"'), m3);
haken.patch = null; haken.archiv = null; // Störung behoben
await pg.getByTestId('erechnung-fehlt').waitFor({ timeout: 10000 });
pr('Warnung „erstellt, aber noch nicht archiviert — vorher nicht versenden"', (await pg.getByTestId('erechnung-fehlt').innerText()).includes('vorher nicht versenden') && rechnungen.rf.status === 'offen' && dokVon('rf').length === 0);
await s('fehlerpfad_nachholen');
await pg.getByRole('button', { name: 'E-Rechnung erzeugen' }).click();
await pg.getByText('E-Rechnung erzeugt und archiviert').waitFor({ timeout: 30000 });
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 10000 });
pr('Nachholen: E-Rechnung archiviert, Nummer unverändert, Warnung weg', dokVon('rf').length === 1 && rechnungen.rf.rechnungsnummer === 'Re_26/2020' && (await pg.getByTestId('erechnung-fehlt').count()) === 0);

// ---- 4) Es gibt schon einen Archiv-Eintrag (z.B. zweiter Tab) → niemals ersetzen
rechnungen.rg = basisR('rg', 'Re_26/2021', 'ag1', 'entwurf', ['28195', 'Bremen']);
positionen.push(P('pg1', 'rg', 1, 'Tour Bremen nach Köln 23.10.26', 350, 'tg1', '2026-10-23'));
await pg.goto(`${B}/rechnungen/rg`);
await pg.getByText('Alle Pflichtangaben vorhanden').waitFor({ timeout: 30000 });
// In der Zwischenzeit wurde die Rechnung woanders erstellt und archiviert:
Object.assign(rechnungen.rg, { status: 'offen', absender_snapshot: { ...settings.firmendaten }, erechnung_format: 'en16931_cii', zahlungsziel_tage: 14, faellig_am: '2026-11-19' });
const vorhanden = { id: 'd-alt', rechnung_id: 'rg', gutschrift_id: null, version: 1, format: 'en16931_cii', typ_code: '380', belegnummer: 'Re_26/2021',
  xml_pfad: 'Maja-Logistik/E-Rechnungen/2026/Re_26_2021.xml', pdf_pfad: 'Maja-Logistik/E-Rechnungen/2026/Re_26_2021.pdf', bucket_pfad: '2026/Re_26_2021.xml',
  sha256_xml: 'c'.repeat(64), sha256_pdf: 'd'.repeat(64), xml_bytes: 1, pdf_bytes: 1, erzeugt_am: '2026-11-06T09:00:00Z', erzeugt_von: 'x', erzeugt_von_name: 'Andere Sitzung', protokoll: null };
dokumente.push(vorhanden);
await pg.getByRole('button', { name: 'Rechnung erstellen' }).click();
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 30000 });
const d4 = dokVon('rg');
pr('Vorhandener Eintrag bleibt unverändert (kein zweiter, nicht ersetzt)', d4.length === 1 && d4[0].id === 'd-alt' && d4[0].sha256_xml === 'c'.repeat(64), d4);
pr('Server lehnt die zweite Ablage ab; Rechnung bleibt erstellt', log.archiv.some((x) => x.id === 'rg') && rechnungen.rg.status === 'offen' && !log.patchR.some((x) => x.id === 'rg' && x.status === 'entwurf'));
pr('Oberfläche zeigt den vorhandenen Archiv-Eintrag', (await pg.getByTestId('erechnung-abschnitt').innerText()).includes('Andere Sitzung'), await pg.getByTestId('erechnung-abschnitt').innerText());

// ---- 5) Teilgutschrift zu einer E-Rechnung: Finalisieren scheitert → Meldung → erneut finalisieren
await pg.goto(`${B}/rechnungen/r1`);
await pg.getByTestId('sperr-hinweis').waitFor({ timeout: 30000 });
await pg.getByRole('button', { name: 'Teilgutschrift' }).click();
await pg.getByRole('dialog').waitFor();
await pg.getByLabel('Position 2 auswählen').check();
await pg.getByRole('button', { name: 'Teilgutschrift als Entwurf anlegen' }).click();
await pg.waitForURL(/\/gutschriften\/g\d+/, { timeout: 20000 });
const gid = new URL(pg.url()).pathname.split('/').pop();
const final = pg.getByRole('button', { name: 'Als final markieren (E-Rechnung erzeugen)' });
await final.waitFor({ timeout: 20000 });
const gNr = gutschriften[gid].gutschrift_nr;
haken.archiv = dauerhaft({ status: 503, body: { error: 'OneDrive vorübergehend nicht erreichbar' } });
await final.click();
await alarm().waitFor({ timeout: 30000 });
const m5 = await alarm().innerText();
pr('Teilgutschrift: Meldung mit Grund und „erneut finalisieren"', m5.includes('OneDrive vorübergehend nicht erreichbar') && m5.includes('Der Beleg ist wieder ein Entwurf und behält seine Nummer') && m5.includes('Was tun: erneut finalisieren'), m5);
pr('Teilgutschrift: wieder Entwurf, Nummer unverändert, kein Archiv-Eintrag', gutschriften[gid].status === 'entwurf' && gutschriften[gid].gutschrift_nr === gNr && !dokumente.some((d) => d.gutschrift_id === gid), gutschriften[gid].status);
haken.archiv = null; // Störung behoben
await final.click();
await pg.getByText(/E-Rechnung \(Typ 381\) erzeugt und archiviert/).waitFor({ timeout: 30000 });
pr('Teilgutschrift: erneut finalisiert → Typ 381, genau EIN Archiv-Eintrag, dieselbe Nummer', gutschriften[gid].status === 'final' && dokumente.filter((d) => d.gutschrift_id === gid).length === 1
  && dokumente.find((d) => d.gutschrift_id === gid).typ_code === '381' && gutschriften[gid].gutschrift_nr === gNr, dokumente.filter((d) => d.gutschrift_id === gid));

await ende(b);
