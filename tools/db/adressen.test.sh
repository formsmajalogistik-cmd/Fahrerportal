#!/usr/bin/env bash
# PLZ/Ort-Schreibskript: Probelauf ändert nichts, echter Lauf schreibt nur Eindeutiges, zweiter Lauf ohne Wirkung
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_adressen
S="$HIER/../../supabase/scripts"
neue_db
for n in 115_erechnung_vorbereitung 116_erechnung_erzeugung 117_erechnung_zugferd_export; do $P -d $DB -f $M/$n.sql >/dev/null 2>&1; done
# Bestand (wie vor Migration 115: Zielfelder leer)
AG2=00000000-0000-0000-0000-0000000000b2; AG3=00000000-0000-0000-0000-0000000000b3
q "update auftraggeber set plz='28816', ort='Stuhr', land_code=null where id='$AGID'" >/dev/null
q "insert into auftraggeber (id, name, plz, ort) values ('$AG2', 'Ohne Adresse GmbH', null, null), ('$AG3', 'Schon DE KG', '26122', 'Oldenburg')" >/dev/null
q "update auftraggeber set land_code=null where id='$AG2'; update auftraggeber set land_code='DE' where id='$AG3'" >/dev/null
q "insert into rechnungsadressen (id, auftraggeber_id, firma, plz_ort, land) values
  ('a0000000-0000-0000-0000-000000000001', '$AGID', 'RA eindeutig', '28195 Bremen', null),
  ('a0000000-0000-0000-0000-000000000002', '$AGID', 'RA mit D-', 'D-20095 Hamburg', 'Deutschland'),
  ('a0000000-0000-0000-0000-000000000003', '$AGID', 'RA Wien', '1010 Wien', 'Österreich'),
  ('a0000000-0000-0000-0000-000000000004', '$AGID', 'RA leer', '', null),
  ('a0000000-0000-0000-0000-000000000005', '$AGID', 'RA teilweise passend', '85609 Aschheim', 'DE'),
  ('a0000000-0000-0000-0000-000000000006', '$AGID', 'RA Konflikt', '85609 Aschheim', null),
  ('a0000000-0000-0000-0000-000000000007', '$AGID', 'RA Land unbekannt', '12345 Irgendwo', 'Atlantis')" >/dev/null
q "update rechnungsadressen set plz=null, ort=null, land_code=null where auftraggeber_id='$AGID'" >/dev/null
q "update rechnungsadressen set plz='85609' where id='a0000000-0000-0000-0000-000000000005'" >/dev/null
q "update rechnungsadressen set plz='80331', ort='München' where id='a0000000-0000-0000-0000-000000000006'" >/dev/null
q "insert into manuelle_empfaenger (id, firma, plz, ort, land) values
  ('e0000000-0000-0000-0000-000000000001', 'ME ohne Land', '28195', 'Bremen', null),
  ('e0000000-0000-0000-0000-000000000002', 'ME Niederlande', '1234 AB', 'Amsterdam', 'Niederlande')" >/dev/null
q "update manuelle_empfaenger set land_code=null" >/dev/null
stand() { q "select md5(string_agg(x, '|' order by x)) from (
  select (id, plz, ort, land_code, plz_ort, land)::text x from rechnungsadressen
  union all select (id, plz, ort, land_code)::text from auftraggeber
  union all select (id, plz, ort, land_code, land)::text from manuelle_empfaenger) t"; }
VORHER=$(stand)

# ---- Probelauf
AUS=$(psql $DBTEST_PSQL -d $DB -At -F '|' -f "$S/erechnung_adressen_schreiben_probelauf.sql" 2>&1)
pr "Probelauf: keine Fehler" "$(echo "$AUS" | grep -c ERROR)" "0"
pr "Probelauf: Stammdaten danach unverändert" "$(stand)" "$VORHER"
TEIL1=$(echo "$AUS" | sed -n '/^BEGIN$/,/^ROLLBACK$/p' | grep '|' | sed 's/^geschrieben|/X|/;s/^manuell prüfen|/M|/' | sort)
TEIL2=$(echo "$AUS" | sed -n '/^ROLLBACK$/,$p' | grep '|' | sed 's/^würde geschrieben|/X|/;s/^manuell prüfen|/M|/' | sort)
pr "Probelauf: Änderung (Schritt 2) und Vorschau (Schritt 4) zeigen dieselben Zeilen (nicht leer)" "$TEIL1|$(echo "$TEIL1" | grep -c .)" "$TEIL2|11"
pr "Probelauf: 5 würden geschrieben (RA Bremen, RA Hamburg, RA teilweise, AG Stuhr, ME ohne Land)" "$(echo "$TEIL2" | grep -c '^X|')" "5"

# ---- Echter Lauf
AUS=$($P -d $DB -At -F '|' -f "$S/erechnung_adressen_schreiben.sql" 2>&1)
pr "Echter Lauf: keine Fehler, 5 geschrieben" "$(echo "$AUS" | grep -c ERROR)|$(echo "$AUS" | grep -c '^geschrieben|')" "0|5"
pr "RA „28195 Bremen\" → 28195/Bremen/DE" "$(q "select plz||'/'||ort||'/'||land_code from rechnungsadressen where id='a0000000-0000-0000-0000-000000000001'")" "28195/Bremen/DE"
pr "RA „D-20095 Hamburg\" → 20095/Hamburg/DE" "$(q "select plz||'/'||ort||'/'||land_code from rechnungsadressen where id='a0000000-0000-0000-0000-000000000002'")" "20095/Hamburg/DE"
pr "RA teilweise gefüllt (PLZ passt): nur Ort + Land ergänzt" "$(q "select plz||'/'||ort||'/'||land_code from rechnungsadressen where id='a0000000-0000-0000-0000-000000000005'")" "85609/Aschheim/DE"
pr "RA Konflikt (gefüllt, weicht ab): unverändert, kein Land-Code" "$(q "select plz||'/'||ort||'/'||coalesce(land_code,'NULL') from rechnungsadressen where id='a0000000-0000-0000-0000-000000000006'")" "80331/München/NULL"
pr "RA Wien / leer / Atlantis: nichts geschrieben" "$(q "select count(*) from rechnungsadressen where id in ('a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000007') and (plz is not null or ort is not null or land_code is not null)")" "0"
pr "plz_ort und land (Freitext) unverändert" "$(q "select string_agg(plz_ort||'/'||coalesce(land,''), ',' order by plz_ort desc) from rechnungsadressen where id in ('a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003')")" "D-20095 Hamburg/Deutschland,1010 Wien/Österreich"
pr "Auftraggeber: Land-Code nur wo eindeutig und leer" "$(q "select string_agg(name||'='||coalesce(land_code,'NULL'), ',' order by name) from auftraggeber where id in ('$AGID','$AG2','$AG3')")" "Arval=DE,Ohne Adresse GmbH=NULL,Schon DE KG=DE"
pr "Manuelle Empfänger: ohne Land → DE, Niederlande → manuell" "$(q "select string_agg(firma||'='||coalesce(land_code,'NULL'), ',' order by firma) from manuelle_empfaenger")" "ME Niederlande=NULL,ME ohne Land=DE"
MANUELL=$(echo "$AUS" | grep '^manuell prüfen|' | cut -d'|' -f3 | sort | tr '\n' ',')
pr "Liste „manuell prüfen\" vollständig" "$MANUELL" "Arval — RA Konflikt,Arval — RA Land unbekannt,Arval — RA Wien,Arval — RA leer,ME Niederlande,Ohne Adresse GmbH,"
hat "Konflikt-Zeile mit Begründung" "$(echo "$AUS" | grep 'RA Konflikt')" "weicht vom Vorschlag ab"
NACH1=$(stand)

# ---- Zweiter Lauf: ohne Wirkung
AUS=$($P -d $DB -At -F '|' -f "$S/erechnung_adressen_schreiben.sql" 2>&1)
pr "Zweiter Lauf: nichts geschrieben, Daten identisch" "$(echo "$AUS" | grep -c '^geschrieben|')|$(stand)" "0|$NACH1"
pr "Zweiter Lauf: Liste „manuell prüfen\" unverändert" "$(echo "$AUS" | grep '^manuell prüfen|' | cut -d'|' -f3 | sort | tr '\n' ',')" "$MANUELL"

# ---- Von Hand eingetragen → erscheint nicht mehr
q "update manuelle_empfaenger set land_code='NL' where firma='ME Niederlande'" >/dev/null
AUS=$($P -d $DB -At -F '|' -f "$S/erechnung_adressen_schreiben.sql" 2>&1)
pr "Selbst eingetragene Zeile verschwindet aus der Liste" "$(echo "$AUS" | grep -c 'ME Niederlande')" "0"

echo "FEHLER: $FEHLER"
$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ "$FEHLER" = "0" ]
