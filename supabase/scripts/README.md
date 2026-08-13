# Manuelle SQL-Skripte

Diese Skripte laufen **nicht** automatisch mit den Migrationen. Sie
liegen bewusst außerhalb von `supabase/migrations/`, weil sie
Bestandsdaten anfassen und nur nach ausdrücklicher Freigabe ausgeführt
werden sollen.

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
