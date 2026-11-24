#!/usr/bin/env bash
# Migration 119: Änderungsanzeige nur bei bestätigten Aufträgen, Bestätigen mit Versionsprüfung
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_119
neue_db
for n in 115_erechnung_vorbereitung 116_erechnung_erzeugung 117_erechnung_zugferd_export 118_auftraggeber_niederlassungen; do $P -d $DB -f $M/$n.sql >/dev/null 2>&1; done
AGU=00000000-0000-0000-0000-0000000000b1   # Auftraggeber-Konto (Arval)
TU=d1190000-0000-0000-0000-000000000001    # noch nicht bestätigt (Einreichung)
TB=d1190000-0000-0000-0000-000000000002    # bestätigt
TA=d1190000-0000-0000-0000-000000000003    # Altbestand: unbestätigt mit offenem Alt-Eintrag
q "insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, startdatum, enddatum, bestaetigt) values
   ('$TU','Bremen','Hamburg','$AGID','2026-12-01','2026-12-01', false),
   ('$TB','Stuhr','Kiel','$AGID','2026-12-02','2026-12-02', true),
   ('$TA','Verden','Celle','$AGID','2026-12-03','2026-12-03', false)" >/dev/null
# Offene Alt-Einträge vor 119 (je eine bestätigte und eine unbestätigte Tour)
q "insert into tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu) values
   ('$TB','$AGU','info',null,'alt bestätigt'), ('$TA','$AGU','info',null,'alt unbestätigt')" >/dev/null
VORHER=$(q "select md5(string_agg(to_jsonb(a)::text, '|' order by id)) from tour_aenderungen a")

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/119_aenderungen_nur_bestaetigt.sql 2>&1 | grep ERROR); pr "Migration 119 (Lauf $i)" "$out" ""; done
pr "Bestehende Einträge unverändert (nur neue Spalte, leer)" "$(q "select md5(string_agg((to_jsonb(a) - 'vor_bestaetigung')::text, '|' order by id)) from tour_aenderungen a")|$(q "select count(*) from tour_aenderungen where vor_bestaetigung is not null")" "$VORHER|0"
pr "Anzeige: Alt-Eintrag der bestätigten Tour sichtbar, der unbestätigten ausgeblendet" "$(als $A "select string_agg(wert_neu, ',' order by wert_neu) from tour_aenderungen_offen")" "alt bestätigt"
pr "Ausgeblendet ≠ gelöscht: Alt-Eintrag der unbestätigten Tour bleibt im Protokoll" "$(als $A "select count(*) from tour_aenderungen where tour_id='$TA' and gesehen_am is null")" "1"

# ---- Auftraggeber ändert unbestätigte Tour → nur Protokoll
STAND_U=$(q "select updated_at from touren where id='$TU'")
r=$(als $AGU "select ag_tour_aktualisieren('$TU', '{\"start_stadt\":\"Bremen\",\"ziel_stadt\":\"Hamburg\",\"startdatum\":\"2026-12-01\",\"enddatum\":\"2026-12-01\",\"info\":\"neue Rampe\"}'::jsonb)->>'ok'")
pr "Auftraggeber ändert unbestätigte Tour" "$r" "true"
pr "… Eintrag im Protokoll, markiert „vor Bestätigung\"" "$(q "select count(*)||'|'||bool_and(vor_bestaetigung) from tour_aenderungen where tour_id='$TU'")" "1|true"
pr "… keine Anzeige, kein Zähler" "$(als $A "select count(*) from tour_aenderungen_offen where tour_id='$TU'")" "0"

# ---- Auftraggeber ändert bestätigte Tour → Anzeige wie bisher
r=$(als $AGU "select ag_tour_aktualisieren('$TB', '{\"start_stadt\":\"Stuhr\",\"ziel_stadt\":\"Kiel\",\"startdatum\":\"2026-12-02\",\"enddatum\":\"2026-12-02\",\"info\":\"Schlüssel beim Pförtner\"}'::jsonb)->>'ok'")
pr "Auftraggeber ändert bestätigte Tour" "$r" "true"
pr "… erscheint in der Anzeige (vor_bestaetigung=false)" "$(als $A "select count(*) from tour_aenderungen_offen where tour_id='$TB' and wert_neu='Schlüssel beim Pförtner' and vor_bestaetigung = false")" "1"

# ---- Sichtbarkeit der Anzeige
pr "Fahrer, Auftraggeber, Test-Konto sehen die Anzeige nicht" "$(als $F "select count(*) from tour_aenderungen_offen")|$(als $AGU "select count(*) from tour_aenderungen_offen")|$(als $TE "select count(*) from tour_aenderungen_offen")" "0|0|0"

# ---- Stand: auch Ansprechpartner-Änderung setzt updated_at
STAND_A=$(q "select updated_at from touren where id='$TA'")
als $AGU "select ag_tour_ansprechpartner_setzen('$TA', 'start', '[{\"name\":\"Frau Neu\",\"telefon\":\"0421 1\"}]'::jsonb)" >/dev/null
pr "Ansprechpartner-Änderung des Auftraggebers setzt den Stand (updated_at) der Tour" "$(q "select updated_at > '$STAND_A'::timestamptz from touren where id='$TA'")" "t"

# ---- Bestätigen mit Versionsprüfung
r=$(als $A "select tour_bestaetigen('$TU', '$STAND_U')")
pr "Änderung zwischen Laden und Bestätigen → nicht bestätigt, geänderte Felder zurück" "$(echo "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ok"], d["grund"], [a["feld"] for a in d["aenderungen"]], d["aenderungen"][0]["neu"])')|$(q "select bestaetigt from touren where id='$TU'")" "False geaendert ['info'] neue Rampe|f"
STAND_U2=$(q "select updated_at from touren where id='$TU'")
q "update touren set info='Admin-Notiz' where id='$TU'" >/dev/null
r=$(als $A "select tour_bestaetigen('$TU', '$STAND_U2')->>'ok'")
pr "Eigene Admin-Änderung nach dem Laden blockiert nicht; Bestätigen mit aktuellem Stand klappt" "$r|$(q "select bestaetigt from touren where id='$TU'")" "true|t"
pr "Einträge aus der Zeit vor der Bestätigung erscheinen auch danach nicht" "$(als $A "select count(*) from tour_aenderungen_offen where tour_id='$TU'")" "0"
STAND_A2=$(q "select updated_at from touren where id='$TA'")
als $A "select tour_bestaetigen('$TA', '$STAND_A2')" >/dev/null
pr "Alt-Eintrag (vor 119) bleibt nach dem Bestätigen ausgeblendet, nicht gelöscht" "$(als $A "select count(*) from tour_aenderungen_offen where tour_id='$TA'")|$(q "select count(*) from tour_aenderungen where tour_id='$TA' and wert_neu='alt unbestätigt' and vor_bestaetigung and gesehen_am is null")" "0|1"
r=$(als $AGU "select ag_tour_aktualisieren('$TU', '{\"start_stadt\":\"Bremen\",\"ziel_stadt\":\"Hamburg\",\"startdatum\":\"2026-12-01\",\"enddatum\":\"2026-12-01\",\"info\":\"nach Bestätigung\"}'::jsonb)->>'ok'")
pr "Änderung NACH der Bestätigung erscheint wieder in der Anzeige" "$r|$(als $A "select string_agg(wert_neu, ',') from tour_aenderungen_offen where tour_id='$TU'")" "true|nach Bestätigung"
pr "Bereits bestätigt → ok, keine Änderung" "$(als $A "select tour_bestaetigen('$TU', '2000-01-01')->>'schon_bestaetigt'")" "true"
hat "Fahrer darf nicht bestätigen" "$(als $F "select tour_bestaetigen('$TB', now())")" "NUR_ADMIN"
hat "Test-Konto darf nicht bestätigen" "$(als $TE "select tour_bestaetigen('$TB', now())")" "NUR_ADMIN"
hat "Auftraggeber darf nicht bestätigen" "$(als $AGU "select tour_bestaetigen('$TB', now())")" "NUR_ADMIN"

$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
exit $FEHLER
