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

## Vorschlags-Pool: Bestandsaufnahme

`vorschlaege_bestand.sql` — **nur lesen.** Zeigt je Topf, wie viele
Einträge drinstehen, eine Stichprobe der häufigsten Werte, wie viel aus
den Tour-Adressen zu holen wäre und welche Formularfelder überhaupt
Adressen liefern. Damit lässt sich die Frage „warum fehlen die Straßen?"
an echten Daten beantworten statt zu raten — die häufigste Ursache steht
in Zeile `nur_freitext_adresse`: Bestandstouren tragen ihre Adresse noch
als Freitext, die strukturierten Spalten sind leer.

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
