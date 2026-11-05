# E-Rechnung — lokale Prüfung (Phase 1a)

Alles hier läuft **lokal und offline**, nur mit **synthetischen Testrechnungen**
(`testrechnungen.ts`). Es werden keine Kundendaten an Dritte übertragen.

## Einmalig einrichten

Voraussetzung: Java ≥ 11.

```
npm run erechnung:validator-einrichten
```

Lädt den KoSIT-Validator und die offiziellen Regel-Dateien von Maven Central
(SHA-1 geprüft) nach `tools/erechnung/.validator/`:

| Teil | Quelle | Version |
|---|---|---|
| KoSIT Validator | `de.kosit:validationtool` (standalone) | 1.5.0 |
| CEN EN 16931 CII-Regeln | `com.helger.phive.rules:phive-rules-en16931` | CEN 1.3.15 |
| KoSIT XRechnung CII-Regeln | `com.helger.phive.rules:phive-rules-xrechnung` | XRechnung 3.0.2 |
| UN/CEFACT CII D16B XSD | `com.helger.cii:ph-cii-d16b` | D16B |

Die Prüfszenarien (`konfiguration/scenarios.xml`) bilden die offizielle
„validator-configuration-xrechnung" nach. **Offizielle Konfiguration
verwenden:** das ZIP `validator-configuration-xrechnung_*.zip` der KoSIT
nach `tools/erechnung/offiziell/` entpacken (dort liegt dann `scenarios.xml`)
— die Prüfung nimmt automatisch diese.

Anderer Maven-Spiegel: `MAVEN_MIRROR=https://… npm run erechnung:validator-einrichten`.

## Prüfen

```
npm run test:erechnung              # Typprüfung + Unit-Tests + Validator
npm run test:erechnung -- --nur-unit
```

Ergebnis: `tools/erechnung/.ausgabe/` — erzeugte XML-Dateien (`xml/`),
Validator-Berichte (`berichte/`) und die Zusammenfassung `bericht.md`.
Die Gegenproben (07–11) **müssen** abgelehnt werden; sie belegen, dass
Schema, CEN-Regeln, Codelisten und XRechnung-Regeln tatsächlich greifen.

## Eine einzelne Datei prüfen (z.B. Test-Export aus der App)

```
java -jar tools/erechnung/.validator/validator.jar \
  -s tools/erechnung/.validator/repo/scenarios.xml \
  -r tools/erechnung/.validator/repo \
  -o /tmp/pruefung  Re_26_1234_TEST.xml
```
