# Browsertests

```
npm run test:e2e                    # alle Läufe
npm run test:e2e -- zugferd         # nur Läufe, deren Name „zugferd" enthält
npm run test:e2e -- --ausfuehrlich  # jede einzelne Prüfung anzeigen
```

Der Läufer (`lauf.mjs`) startet die App lokal mit einer **Stub-Konfiguration**
und steuert sie mit Playwright. Supabase, OneDrive-API und Mailversand werden
im Test abgefangen und nachgebildet — es wird **nichts** an das echte Projekt,
an OneDrive oder per E-Mail gesendet, und es werden nur erfundene Daten benutzt.

Voraussetzung: Playwright mit Chromium (bewusst keine Abhängigkeit des
Projekts): `npm i -g playwright && npx playwright install chromium`, oder
`E2E_PLAYWRIGHT=/pfad/zu/node_modules/playwright` setzen.

| Datei | Inhalt |
|---|---|
| `leerfahrt` | Leerfahrt markieren/entfernen, Wasserzeichen, Filter |
| `keine-auslagen` | Zusatz „Keine Auslagen" in Tourenliste, Tour-Detail, Posteingang, Prüfdialog |
| `rechnung-neu-laden` | „Touren neu laden", Prüfdialog beim Erstellen |
| `erechnung-stammdaten` | Empfänger-Stammdaten, Test-Export (XML und ZUGFeRD), mit/ohne Migration 115 |
| `erechnung-ablauf` | Erstellen, Sperre, Versand, Storno (381), Teilgutschrift, PDF-Versionierung |
| `erechnung-fehlerpfad` | Ablage scheitert → Meldung, erneuter Versuch, nichts doppelt/überschrieben |
| `erechnung-zugferd` | ZUGFeRD im App-Ablauf (eine Datei), Versand, Storno; Messung Größe/Dauer |
| `erechnung-export` | Archiv-Export: Filter, ZIP/CSV, Hash-Prüfung, Protokoll |

Ausgabe (Screenshots, abgefangene Dateien, Messwerte): `tools/e2e/.ausgabe/`.
Die im ZUGFeRD-Lauf abgefangenen PDFs lassen sich direkt validieren:

```
npm run erechnung:pruefe-zugferd -- tools/e2e/.ausgabe/erechnung-zugferd_light/xml/*.pdf
```

Scheitert ein Lauf, wird er **einmal** wiederholt (kalter Start der App); das
steht dann ausdrücklich in der Ausgabe („erst im 2. Versuch").

Die Datenbank-Trigger selbst (Sperren, Snapshot, Nummernvergabe) prüfen die
Tests in `tools/db/` gegen einen lokalen PostgreSQL — die Browsertests bilden
sie nur so weit nach, wie die Oberfläche sie braucht.
