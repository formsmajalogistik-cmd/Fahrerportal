#!/usr/bin/env bash
# Migration 115: Fälligkeit, Empfänger- und Positionsfelder
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_115
neue_db
# Bestand VOR der Migration: eine erstellte, eine Entwurfs-Rechnung, Adresse, manueller Empfänger
q "update auftraggeber set zahlungsziel_tage = 14 where id = '$AGID'" >/dev/null
q "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status, netto_summe, ust_satz, ust_betrag, brutto_summe)
   values ('c0000000-0000-0000-0000-000000000001', '$AGID', '2026-10-01', '2026-09-01', '2026-09-30', 'offen', 100, 19, 19, 119),
          ('c0000000-0000-0000-0000-000000000002', '$AGID', '2026-10-02', '2026-09-01', '2026-09-30', 'entwurf', 100, 19, 19, 119)" >/dev/null
q "insert into rechnungsadressen (auftraggeber_id, firma, plz_ort, land) values ('$AGID', 'Arval Rechnung', '85609 Aschheim', 'Deutschland')" >/dev/null
q "insert into manuelle_empfaenger (firma, plz, ort, land) values ('Sub GmbH', '28195', 'Bremen', '')" >/dev/null
VORHER=$(q "select md5(string_agg(t::text,'|' order by id)) from (select id, rechnungsnummer, datum, status, netto_summe, ust_betrag, brutto_summe, auftraggeber_id from rechnungen) t")

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/115_erechnung_vorbereitung.sql 2>&1 | grep ERROR); pr "Migration 115 (Lauf $i)" "$out" ""; done
pr "Bestandsrechnungen unverändert" "$(q "select md5(string_agg(t::text,'|' order by id)) from (select id, rechnungsnummer, datum, status, netto_summe, ust_betrag, brutto_summe, auftraggeber_id from rechnungen) t")" "$VORHER"
pr "Bestand: neue Felder leer" "$(q "select count(*) from rechnungen where faellig_am is not null or zahlungsziel_tage is not null or rechnungsadresse_plz is not null or erechnung_format is not null")|$(q "select coalesce(land_code,'NULL') from auftraggeber")|$(q "select coalesce(land_code,'NULL')||coalesce(plz,'NULL') from rechnungsadressen")|$(q "select coalesce(land_code,'NULL')||erechnung_format from manuelle_empfaenger")" "0|NULL|NULLNULL|NULLpdf"
pr "Neue Zeilen: land_code Default DE" "$(q "insert into manuelle_empfaenger (firma) values ('Neu') returning land_code")" "DE"

# Bestand: offene Rechnung bleibt ohne faellig_am, auch bei Statuswechsel offen → bezahlt → offen
als $A "update rechnungen set status='bezahlt', bezahlt_am='2026-10-10' where id='c0000000-0000-0000-0000-000000000001'" >/dev/null
als $A "update rechnungen set status='offen', bezahlt_am=null where id='c0000000-0000-0000-0000-000000000001'" >/dev/null
pr "Bestand offen→bezahlt→offen: faellig_am bleibt leer" "$(q "select coalesce(faellig_am::text,'NULL') from rechnungen where id='c0000000-0000-0000-0000-000000000001'")" "NULL"

# Entwurf → erstellt (Admin über RLS)
als $A "update rechnungen set status='offen' where id='c0000000-0000-0000-0000-000000000002'" >/dev/null
pr "Entwurf → offen: faellig = Datum + 14, Ziel übernommen" "$(q "select faellig_am||'|'||zahlungsziel_tage from rechnungen where id='c0000000-0000-0000-0000-000000000002'")" "2026-10-16|14"
# Danach ändert sich nichts mehr, auch nicht bei geändertem Zahlungsziel/Datum
q "update auftraggeber set zahlungsziel_tage = 30 where id = '$AGID'" >/dev/null
als $A "update rechnungen set datum='2026-10-05' where id='c0000000-0000-0000-0000-000000000002'" >/dev/null
als $A "update rechnungen set status='bezahlt' where id='c0000000-0000-0000-0000-000000000002'" >/dev/null
pr "Einmalig: spätere Änderungen lassen faellig_am stehen" "$(q "select faellig_am||'|'||zahlungsziel_tage from rechnungen where id='c0000000-0000-0000-0000-000000000002'")" "2026-10-16|14"

# Neu direkt als offen angelegt (Auftraggeber, Ziel 30)
out=$(als $A "insert into rechnungen (auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'offen') returning faellig_am||'|'||zahlungsziel_tage")
pr "Neu als offen: faellig = Datum + 30" "$out" "2026-12-03|30"
# Neu als Entwurf: noch nichts
out=$(als $A "insert into rechnungen (auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'entwurf') returning coalesce(faellig_am::text,'NULL')||'|'||coalesce(zahlungsziel_tage::text,'NULL')")
pr "Neu als Entwurf: faellig leer" "$out" "NULL|NULL"
# Manuell mit eigenem Zahlungsziel 10
out=$(als $A "insert into rechnungen (empfaenger_typ, datum, leistungszeitraum_von, leistungszeitraum_bis, status, zahlungsziel_tage) values ('manuell', '2026-11-03', '2026-10-01', '2026-10-31', 'offen', 10) returning faellig_am||'|'||zahlungsziel_tage")
pr "Manuell: faellig = Datum + 10" "$out" "2026-11-13|10"
# Manuell ohne Zahlungsziel: bleibt leer (wie bisher kein Fälligkeitsdatum)
out=$(als $A "insert into rechnungen (empfaenger_typ, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('manuell', '2026-11-03', '2026-10-01', '2026-10-31', 'offen') returning coalesce(faellig_am::text,'NULL')")
pr "Manuell ohne Ziel: faellig leer" "$out" "NULL"
# Auftraggeber ohne Zahlungsziel: faellig leer (wie bisher)
q "update auftraggeber set zahlungsziel_tage = null where id = '$AGID'" >/dev/null
out=$(als $A "insert into rechnungen (auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'offen') returning coalesce(faellig_am::text,'NULL')")
pr "AG ohne Ziel: faellig leer" "$out" "NULL"

# Prüfregeln
pr "Format-Check" "$(q "update auftraggeber set erechnung_format='xml'" | grep -c check)" "1"
pr "Land-Code-Check" "$(q "update auftraggeber set land_code='Deutschland'" | grep -c check)" "1"
pr "Einheit-Check" "$(q "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis, einheit_code) values ('c0000000-0000-0000-0000-000000000002', 9, 'x', 1, 1, 'stück')" | grep -c check)" "1"
pr "Steuerkategorie-Check" "$(q "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis, steuerkategorie) values ('c0000000-0000-0000-0000-000000000002', 9, 'x', 1, 1, 'X')" | grep -c check)" "1"
pr "Gültige Werte gehen" "$(q "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis, einheit_code, steuerkategorie) values ('c0000000-0000-0000-0000-000000000002', 9, 'x', 1, 1, 'C62', 'S') returning einheit_code||steuerkategorie")" "C62S"
# Fahrer darf Rechnungen weiterhin nicht sehen
pr "RLS unverändert: Fahrer sieht keine Rechnungen" "$(als 00000000-0000-0000-0000-0000000000f1 "select count(*) from rechnungen")" "0"
echo "FEHLER: $FEHLER"
$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ "$FEHLER" = "0" ]
