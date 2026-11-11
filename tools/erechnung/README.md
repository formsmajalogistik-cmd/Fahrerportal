# E-Rechnung — lokale Prüfung

Alles hier läuft **lokal und offline**, nur mit **synthetischen Testrechnungen**
(`testrechnungen.ts`). Es werden keine Kundendaten an Dritte übertragen.

## Einmalig einrichten

Voraussetzung: Java ≥ 11.

```
npm run erechnung:validator-einrichten
```

Lädt die Validatoren und die offiziellen Regel-Dateien von Maven Central
(SHA-1 geprüft) nach `tools/erechnung/.validator/`:

| Teil | Quelle | Version |
|---|---|---|
| KoSIT Validator | `de.kosit:validationtool` (standalone) | 1.5.0 |
| CEN EN 16931 CII-Regeln | `com.helger.phive.rules:phive-rules-en16931` | CEN 1.3.15 |
| KoSIT XRechnung CII-Regeln | `com.helger.phive.rules:phive-rules-xrechnung` | XRechnung 3.0.2 |
| UN/CEFACT CII D16B XSD | `com.helger.cii:ph-cii-d16b` | D16B |
| veraPDF (PDF/A-3b) | `org.verapdf.apps:greenfield-apps` | 1.28.2 |
| Mustang (ZUGFeRD-Gegenprobe) | `org.mustangproject:Mustang-CLI` | 2.26.0 |

Die Prüfszenarien (`konfiguration/scenarios.xml`) bilden die offizielle
„validator-configuration-xrechnung" nach. **Offizielle Konfiguration
verwenden:** das ZIP `validator-configuration-xrechnung_*.zip` der KoSIT
nach `tools/erechnung/offiziell/` entpacken (dort liegt dann `scenarios.xml`)
— die Prüfung nimmt automatisch diese.

Anderer Maven-Spiegel: `MAVEN_MIRROR=https://… npm run erechnung:validator-einrichten`.

## Prüfen

```
npm run test:erechnung              # Typprüfung + Unit-Tests + Server-Tests + Validatoren
npm run test:erechnung -- --nur-unit
```

Schritte:

0. Typprüfung
1. Unit-Tests (XML-Generator, Pflichtfeld-Prüfung, PDF, ZIP/CSV) und
   Server-Tests der Archiv-Ablage (wiederholbar, nichts wird überschrieben)
2. KoSIT: alle Testrechnungen als XML (XRechnung und EN 16931). Die
   Gegenproben (07–11) **müssen** abgelehnt werden; sie belegen, dass Schema,
   CEN-Regeln, Codelisten und XRechnung-Regeln tatsächlich greifen.
3. ZUGFeRD: dieselben Testfälle als PDF/A-3 mit eingebettetem XML —
   veraPDF (PDF/A-3b), KoSIT (das aus dem PDF gelesene XML) und Mustang
   (ganze Datei). Zusätzlich: eingebettetes XML = erzeugtes XML (Byte für Byte).

Ergebnis: `tools/erechnung/.ausgabe/` — erzeugte Dateien, Validator-Berichte
und die Zusammenfassungen `bericht.md` und `bericht-zugferd.md`.

## Einzelne Dateien prüfen (z.B. Test-Export aus der App)

ZUGFeRD-PDF (veraPDF + KoSIT + Mustang in einem Lauf):

```
npm run erechnung:pruefe-zugferd -- Re_26_1234_TEST.pdf [weitere.pdf …]
```

XML-Datei (XRechnung / EN 16931):

```
java -jar tools/erechnung/.validator/validator.jar \
  -s tools/erechnung/.validator/repo/scenarios.xml \
  -r tools/erechnung/.validator/repo \
  -o /tmp/pruefung  Re_26_1234_TEST.xml
```

Bitte nur Testdateien prüfen, die das Haus nicht verlassen — die Werkzeuge
arbeiten offline, es wird nichts hochgeladen.
