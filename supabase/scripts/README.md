# Manuelle SQL-Skripte

Diese Skripte laufen **nicht** automatisch mit den Migrationen. Sie
liegen bewusst außerhalb von `supabase/migrations/`, weil sie
Bestandsdaten anfassen und nur nach ausdrücklicher Freigabe ausgeführt
werden sollen.

## Storage-Ablagen prüfen

`buckets_pruefen.sql` — **nur lesen.** Zeigt für jede von der App
benutzte Ablage, ob sie existiert, ob sie privat ist und welche
Zugriffsregeln auf ihr liegen; dazu die Belegung. Anlass war der Fehler
„Bucket nicht gefunden" beim Hinterlegen der Unterschrift — die Ablage
war nicht angelegt, weil die Migration noch nicht eingespielt war. Bei
jedem solchen Fehler zuerst dieses Skript laufen lassen: es nennt
direkt die Migration, die fehlt.

## Falsch abgelegte Belege finden

`belege_fehlablage.sql` — **nur lesen.** Zählt, wie viele nachträglich
ergänzte Belege in einer Zusatzbilder-Sektion statt in der Beleg-Sektion
liegen (beide haben denselben Feldtyp `dynamic_photos`). Zeigt außerdem
je Template, welche Bild-Sektionen es gibt und welche Templates gar
keine erkennbare Beleg-Sektion haben. **Verschiebt nichts** — das
Umhängen gibt es erst nach ausdrücklicher Freigabe.

## Alt-Adressen (Freitext) in die strukturierten Felder überführen

Reihenfolge:

1. `adressen_bestandsaufnahme.sql` — **nur lesen.** Zeigt, ob die
   Spalten existieren, wie viele Touren betroffen sind und wie die
   Alt-Werte aufgebaut sind.
2. `adressen_uebernahme.sql` — übernimmt den kompletten Alt-Wert
   unverändert in `strasse_*`, nur wo dieses Feld leer ist. Die alten
   Spalten bleiben erhalten, der Lauf ist idempotent und meldet
   vorher/nachher.
3. `adressen_plz_trockenlauf.sql` — **nur lesen.** Zeigt, was eine
   vorsichtige PLZ-Extraktion ändern *würde*. Das zugehörige
   Update-Skript gibt es erst nach Freigabe.

Rückgängig machen: Schritt 2 lässt sich zurücknehmen, indem die
betroffenen `strasse_*` wieder geleert werden — der Originalwert steht
unverändert in `adresse_*`.

## Pool aufräumen: Fremd-Töpfe und ganze Adressen

Vorschläge sind seit Migration 095 ausschließlich eine ADRESS-Funktion.
Was aus der Zeit davor noch im Pool liegt, wird hier gefunden:

1. `pool_aufraeumen_trockenlauf.sql` — **nur lesen.** Zeigt, wie viele
   Einträge in Töpfen liegen, die es nicht mehr geben soll
   (Kennzeichen, Modelle, E-Mails, Namen …) und wie viele Straßen-
   Einträge in Wahrheit ganze Adressen sind („Heiligenroder Strasse 38e,
   28816 Stuhr"). Mit bis zu 30 Beispielen, dazu je Eintrag der
   Vorschlag, was ein KÜRZEN auf den Straßenteil ergäbe.
2. `pool_aufraeumen_block.sql` — löscht beides, höchstens 500 Zeilen pro
   Lauf. So oft ausführen, bis `offen_danach` 0 meldet.

Bewusst löschen statt kürzen: vor der PLZ steht nicht immer eine
brauchbare Straße. Wer kürzen will, entscheidet das anhand der Spalte
`vorschlag_kuerzen` im Trockenlauf.

Dasselbe geht auch ohne SQL: in der Pool-Pflege gibt es die Filter
**„Sonstige"** und **„Ganze Adressen"** samt Mehrfachauswahl und
Sammel-Löschen.

## Adress-Pool bereinigen (Schreibweise + Dubletten)

Bequemer Weg: In der Pool-Pflege gibt es den Knopf **„Adress-Pool
bereinigen"** — er ruft die RPC aus Migration 094 blockweise auf und
zeigt den Fortschritt. Kein SQL-Editor nötig.

Von Hand geht es genauso, jeweils so oft ausführen, bis `offen_danach`
0 meldet:

1. `vorschlaege_status.sql` — **nur lesen.** Wie viele Einträge gibt es,
   wie viele sind noch nicht normalisiert, wie viele Dubletten-Gruppen
   entstehen, plus die zwanzig größten Gruppen als Beispiel.
2. `vorschlaege_duplikate_block.sql` — führt bis zu 500 Wertgruppen
   zusammen (`anzahl` wird addiert, `letzte_nutzung` auf den jüngsten
   Wert gesetzt), löscht die überzähligen Zeilen.
3. `vorschlaege_normalisieren_block.sql` — bringt bis zu 500 Zeilen auf
   die einheitliche Schreibweise und zieht das Adressbuch nach.

Reihenfolge 2 vor 3: Dubletten müssen zuerst weg, sonst liefe das
Umbenennen in die Eindeutigkeit `(feld_typ, wert)`. Alle drei Skripte
sind beliebig oft wiederholbar.

Der frühere Einzeldurchlauf in Migration 093 lief im SQL-Editor in einen
Verbindungs-Timeout („Failed to fetch") — er verglich für jede Gruppe die
komplette Tabelle. 093 legt deshalb nur noch die Funktionen an.

## Vorschlags-Pool: Bestandsaufnahme

`vorschlaege_bestand.sql` — **nur lesen.** Zeigt je Topf, wie viele
Einträge drinstehen, eine Stichprobe der häufigsten Werte, wie viel aus
den Tour-Adressen zu holen wäre und welche Formularfelder überhaupt
Adressen liefern.

Nachtrag: Die ursprüngliche Frage „warum fehlen die Straßen?" hatte einen
anderen Grund — sie fehlten gar nicht, sie waren nur in der Pflegeansicht
nicht zu sehen. Die Liste wurde ohne Blättern geladen und der Server
schnitt bei seiner Zeilen-Obergrenze ab; weil nach `feld_typ` sortiert
wird, fiel ausgerechnet `adresse_strasse` heraus. Behoben. Die Zeile
`nur_freitext_adresse` bleibt trotzdem nützlich: sie zeigt Bestandstouren,
deren Adresse noch als Freitext dasteht.

## Vorschlags-Pool nachträglich befüllen

Der Pool blieb leer, weil die Sammlung ein reines Opt-in war, das bei
den produktiven Templates nirgends aktiviert wurde (Migration 090 stellt
das auf automatische Ableitung um). Damit er nicht bei null startet:

1. `vorschlaege_trockenlauf.sql` — **nur lesen.** Zeigt je Topf, wie
   viele Einträge aus den eingereichten Formularen und den
   Tour-Adressfeldern entstehen würden, plus 20 Beispielwerte.
2. `vorschlaege_uebernahme.sql` — legt sie an. Bestehende Werte werden
   hochgezählt statt verdoppelt, kurze Werte (< 3 Zeichen) fallen weg.
   Ein zweiter Lauf bricht mit einer Meldung ab
   (`vorschlaege_backfill_log`).
