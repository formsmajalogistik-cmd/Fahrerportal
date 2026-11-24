#!/usr/bin/env bash
# Migration 120: Interne Info (nur Admin) + Leerfahrt mit Grund
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_120
neue_db
for n in 115_erechnung_vorbereitung 116_erechnung_erzeugung 117_erechnung_zugferd_export 118_auftraggeber_niederlassungen 119_aenderungen_nur_bestaetigt; do $P -d $DB -f $M/$n.sql >/dev/null 2>&1; done
AGU=00000000-0000-0000-0000-0000000000b1
T1=d1200000-0000-0000-0000-000000000001
T2=d1200000-0000-0000-0000-000000000002
q "insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, fahrer_id, startdatum, enddatum, tourenart, kennzeichen, info, bestaetigt) values
   ('$T1','Bremen','Hamburg','$AGID','$FID','2026-12-01','2026-12-01','AB', array['HB-L 1'], 'Info für alle', true),
   ('$T2','Achim','Lüneburg','$AGID','$FID','2026-12-02','2026-12-02','ABA', array['HB-S 1','LG-S 2'], null, true)" >/dev/null
q "update touren set rueckfuehrung_stadt='Achim' where id='$T2'" >/dev/null
VORHER=$(q "select md5(string_agg(to_jsonb(t)::text, '|' order by id)) from touren t")

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/120_interne_info_leerfahrt_grund.sql 2>&1 | grep ERROR); pr "Migration 120 (Lauf $i)" "$out" ""; done
pr "Bestand unverändert (touren, Infofeld)" "$(q "select md5(string_agg(to_jsonb(t)::text, '|' order by id)) from touren t")" "$VORHER"

# ---- Interne Info: nur Admin
als $A "insert into touren_admin_info (tour_id, interne_info) values ('$T1', 'Kunde zahlt schlecht')" >/dev/null
pr "Admin schreibt und liest die interne Info" "$(als $A "select interne_info from touren_admin_info where tour_id='$T1'")" "Kunde zahlt schlecht"
pr "Fahrer, Auftraggeber, Test-Konto: direkte Abfrage liefert nichts" "$(als $F "select count(*) from touren_admin_info")|$(als $AGU "select count(*) from touren_admin_info")|$(als $TE "select count(*) from touren_admin_info")" "0|0|0"
hat "Fahrer darf nicht schreiben" "$(als $F "insert into touren_admin_info (tour_id, interne_info) values ('$T2', 'x')")" "row-level security"
hat "Test-Konto darf nicht schreiben" "$(als $TE "insert into touren_admin_info (tour_id, interne_info) values ('$T2', 'x')")" "row-level security"
pr "Auftraggeber/Test: Update wirkt nicht (0 Zeilen)" "$(als $AGU "update touren_admin_info set interne_info='x' returning 1" | grep -c 1)|$(als $TE "update touren_admin_info set interne_info='x' returning 1" | grep -c 1)|$(q "select interne_info from touren_admin_info where tour_id='$T1'")" "0|0|Kunde zahlt schlecht"
pr "Keine View/Kundensicht enthält die Felder" "$(q "select count(*) from information_schema.columns c join information_schema.views v on v.table_schema=c.table_schema and v.table_name=c.table_name where c.table_schema='public' and c.column_name in ('interne_info','leerfahrt_grund','leerfahrt_text','leerfahrt_zeile')")" "0"
pr "touren hat keine solche Spalte" "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='touren' and column_name in ('interne_info','leerfahrt_grund')")" "0"
pr "Änderungsprotokoll: Eintrag (Quelle intern, gesehen) — nur Admin lesbar" "$(als $A "select feld||'|'||quelle||'|'||(gesehen_am is not null) from tour_aenderungen where tour_id='$T1' and feld='interne_info'")|$(als $TE "select count(*) from tour_aenderungen where feld='interne_info'")" "interne_info|intern|true|0"
pr "Protokolleintrag erscheint nicht in „Änderungen durch Auftraggeber\"" "$(als $A "select count(*) from tour_aenderungen_offen where feld='interne_info'")" "0"

# ---- Leerfahrt mit Grund
hat "Ohne Grund: abgelehnt" "$(als $A "select tour_leerfahrt_mit_grund('$T1', true, null, null, 'Leerfahrt')")" "GRUND_FEHLT"
hat "Sonstiges ohne Text: abgelehnt" "$(als $A "select tour_leerfahrt_mit_grund('$T1', true, 'sonstiges', '  ', 'Leerfahrt – ')")" "GRUND_TEXT_FEHLT"
hat "Fahrer darf keine Leerfahrt setzen" "$(als $F "select tour_leerfahrt_mit_grund('$T1', true, 'defekt', null, 'Leerfahrt – Fahrzeug defekt')")" "NUR_ADMIN"
hat "Test-Konto darf keine Leerfahrt setzen" "$(als $TE "select tour_leerfahrt_mit_grund('$T1', true, 'defekt', null, 'Leerfahrt – Fahrzeug defekt')")" "NUR_ADMIN"
r=$(als $A "select tour_leerfahrt_mit_grund('$T1', true, 'defekt', 'Bremse blockiert', 'Leerfahrt – Fahrzeug defekt (Bremse blockiert)')")
pr "Leerfahrt mit Grund: Zeile angehängt, bestehender Text bleibt" "$(q "select interne_info from touren_admin_info where tour_id='$T1'" | tr '\n' '/')" "Kunde zahlt schlecht/Leerfahrt – Fahrzeug defekt (Bremse blockiert)/"
pr "… Grund und Text strukturiert gespeichert, Leerfahrt markiert" "$(q "select leerfahrt_grund||'|'||leerfahrt_text from touren_admin_info where tour_id='$T1'")|$(q "select count(*) from tour_leerfahrt where tour_id='$T1'")" "defekt|Bremse blockiert|1"
pr "… bisheriges Infofeld unverändert" "$(q "select info from touren where id='$T1'")" "Info für alle"
als $A "select tour_leerfahrt_mit_grund('$T2', true, 'keine_zulassung', null, 'Leerfahrt – Fahrzeug hat keine Zulassung')" >/dev/null
pr "Leeres Feld: Eintrag steht allein" "$(q "select interne_info from touren_admin_info where tour_id='$T2'")" "Leerfahrt – Fahrzeug hat keine Zulassung"

als $A "select tour_leerfahrt_mit_grund('$T1', true, 'kurzfristiger_storno', null, 'Leerfahrt – Kurzfristiger Storno')" >/dev/null
pr "Grund ändern: Systemzeile ersetzt" "$(q "select interne_info||'|'||leerfahrt_grund||'|'||coalesce(leerfahrt_text,'-') from touren_admin_info where tour_id='$T1'" | tr '\n' '/')" "Kunde zahlt schlecht/Leerfahrt – Kurzfristiger Storno|kurzfristiger_storno|-/"
pr "… Grundänderung im Protokoll" "$(als $A "select count(*) from tour_aenderungen where tour_id='$T1' and quelle='leerfahrt' and wert_neu like 'Grund geändert: %Storno'")" "1"

# Keine Auslagen aus der Leerfahrt (wie 114: der Client legt sie mit herkunft 'leerfahrt' an)
q "insert into tour_zusaetze (tour_id, kategorie, anzahl, betrag, kennzeichen, herkunft) values ('$T1', 'Keine Auslagen', 1, 0, 'HB-L 1', 'leerfahrt')" >/dev/null 2>&1
KA=$(q "select count(*) from tour_zusaetze where tour_id='$T1' and herkunft='leerfahrt'")
r=$(als $A "select tour_leerfahrt_mit_grund('$T1', false)")
pr "Leerfahrt entfernen: Zeile entfernt, übriger Text bleibt, Grund leer" "$(q "select interne_info||'|'||coalesce(leerfahrt_grund,'-')||'|'||coalesce(leerfahrt_zeile,'-') from touren_admin_info where tour_id='$T1'")|$(echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["info_manuell"])')" "Kunde zahlt schlecht|-|-|False"
pr "… Markierung weg, automatische „Keine Auslagen\" entfernt (wie 114)" "$(q "select count(*) from tour_leerfahrt where tour_id='$T1'")|$KA→$(q "select count(*) from tour_zusaetze where tour_id='$T1' and herkunft='leerfahrt'")" "0|1→0"

# Zeile von Hand geändert → nicht anfassen
als $A "update touren_admin_info set interne_info = 'Leerfahrt – Fahrzeug hat keine Zulassung (Kunde informiert)' where tour_id='$T2'" >/dev/null
r=$(als $A "select tour_leerfahrt_mit_grund('$T2', true, 'defekt', null, 'Leerfahrt – Fahrzeug defekt')")
pr "Grund ändern bei von Hand geänderter Zeile: Text unberührt, Hinweis" "$(q "select interne_info from touren_admin_info where tour_id='$T2'")|$(echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["info_manuell"])')|$(q "select leerfahrt_grund from touren_admin_info where tour_id='$T2'")" "Leerfahrt – Fahrzeug hat keine Zulassung (Kunde informiert)|True|defekt"

# ---- Tour-Split übernimmt interne Info + Grund
NEU=$(als $A "select tour_aufteilen('$T2', '{}'::jsonb) ->> 'neue_tour_id'")
pr "Tour aufteilen: interne Info und Grund auf beiden Teilen" "$(q "select count(*) from touren_admin_info where tour_id in ('$T2','$NEU') and interne_info like 'Leerfahrt – Fahrzeug hat keine Zulassung%' and leerfahrt_grund='defekt'")" "2"
r=$(als $A "select tour_leerfahrt_mit_grund('$T2', false)")
pr "Entfernen bei von Hand geänderter Zeile: Text bleibt, Hinweis" "$(q "select interne_info from touren_admin_info where tour_id='$T2'")|$(echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["info_manuell"])')" "Leerfahrt – Fahrzeug hat keine Zulassung (Kunde informiert)|True"

# ---- Löschen der Tour löscht die interne Info mit
q "delete from touren where id='$NEU'" >/dev/null
pr "Tour gelöscht → interne Info mit gelöscht (keine Waisen)" "$(q "select count(*) from touren_admin_info where tour_id='$NEU'")" "0"

$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
exit $FEHLER
