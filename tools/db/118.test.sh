#!/usr/bin/env bash
# Migration 118: Niederlassungen eines Auftraggebers
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_118
neue_db
for n in 115_erechnung_vorbereitung 116_erechnung_erzeugung 117_erechnung_zugferd_export; do $P -d $DB -f $M/$n.sql >/dev/null 2>&1; done
AG2=00000000-0000-0000-0000-0000000000b2
AGU=00000000-0000-0000-0000-0000000000b1   # Auftraggeber-Konto (seed: ag@arval.de → Arval)
q "update auftraggeber set ort='Stuhr', strasse='Heiligenroder Str. 1', plz='28816', land_code='DE', zahlungsziel_tage=14, erechnung_format='en16931_cii',
     erechnung_email='eingang@arval.example', kaeufer_referenz='REF-HAUPT', email1='rechnung@arval.example' where id='$AGID'" >/dev/null
q "insert into auftraggeber (id, name, ort) values ('$AG2', 'Andere GmbH', 'Kiel')" >/dev/null

# Bestand VOR 118: Tour, Entwurf, erstellte Rechnung mit E-Rechnung
T0=d0000000-0000-0000-0000-000000000001; R0=c0000000-0000-0000-0000-000000000001
q "insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, startdatum, enddatum) values ('$T0','Bremen','Hamburg','$AGID','2026-10-30','2026-10-30')" >/dev/null
q "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$R0', '$AGID', '2026-11-01', '2026-10-01', '2026-10-31', 'offen')" >/dev/null
srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$R0','en16931_cii','380','Re-0','a.xml','a.pdf','2026/a.xml',repeat('a',64),repeat('b',64),1,1)" >/dev/null
STAND() { q "select md5(coalesce((select string_agg(to_jsonb(t)::text, '|' order by id) from touren t), '') || coalesce((select string_agg((to_jsonb(r) - 'niederlassung_id')::text, '|' order by id) from rechnungen r), ''))"; }
VORHER=$(STAND)

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/118_auftraggeber_niederlassungen.sql 2>&1 | grep ERROR); pr "Migration 118 (Lauf $i)" "$out" ""; done
pr "Bestand unverändert, niederlassung_id leer (= Hauptsitz)" "$(q "select md5(coalesce((select string_agg((to_jsonb(t) - 'niederlassung_id')::text, '|' order by id) from touren t), '') || coalesce((select string_agg((to_jsonb(r) - 'niederlassung_id')::text, '|' order by id) from rechnungen r), ''))")|$(q "select count(*) from touren where niederlassung_id is not null")" "$(q "select md5(coalesce((select string_agg((to_jsonb(t) - 'niederlassung_id')::text, '|' order by id) from touren t), '') || coalesce((select string_agg((to_jsonb(r) - 'niederlassung_id')::text, '|' order by id) from rechnungen r), ''))")|0"
hat "Gesperrte E-Rechnung: Niederlassung nicht nachträglich setzbar" "$(als $A "update rechnungen set niederlassung_id = null, notizen = 'x', datum = '2026-11-02' where id='$R0'")" "ERECHNUNG_GESPERRT"

# ---- Niederlassungen anlegen (nur Admin)
NB=e1000000-0000-0000-0000-000000000001; NX=e1000000-0000-0000-0000-000000000002; NI=e1000000-0000-0000-0000-000000000003
als $A "insert into auftraggeber_niederlassungen (id, auftraggeber_id, bezeichnung, strasse, plz, ort, erechnung_email, kaeufer_referenz) values ('$NB', '$AGID', 'Bremen', 'Hafenstraße 1', '28195', 'Bremen', 'eingang-bremen@arval.example', 'REF-BREMEN')" >/dev/null
pr "Admin legt Niederlassung an (Land DE vorbelegt, aktiv)" "$(q "select bezeichnung||'|'||land_code||'|'||aktiv from auftraggeber_niederlassungen where id='$NB'")" "Bremen|DE|true"
hat "Gleiche Bezeichnung je Auftraggeber nur einmal" "$(als $A "insert into auftraggeber_niederlassungen (auftraggeber_id, bezeichnung) values ('$AGID', ' bremen ')")" "duplicate key"
hat "Leere Bezeichnung unzulässig" "$(als $A "insert into auftraggeber_niederlassungen (auftraggeber_id, bezeichnung) values ('$AGID', '  ')")" "bezeichnung_check"
pr "Fahrer/Test dürfen nicht anlegen (RLS)" "$(als $F "insert into auftraggeber_niederlassungen (auftraggeber_id, bezeichnung) values ('$AGID', 'F')" | grep -c 'row-level security')|$(als $TE "insert into auftraggeber_niederlassungen (auftraggeber_id, bezeichnung) values ('$AGID', 'T')" | grep -c 'row-level security')" "1|1"
q "insert into auftraggeber_niederlassungen (id, auftraggeber_id, bezeichnung, ort) values ('$NX', '$AG2', 'Lübeck', 'Lübeck'), ('$NI', '$AGID', 'Alt-Standort', 'Verden')" >/dev/null
pr "Auftraggeber-Konto sieht nur die eigenen Niederlassungen" "$(als $AGU "select string_agg(bezeichnung, ',' order by bezeichnung) from auftraggeber_niederlassungen")" "Alt-Standort,Bremen"
pr "Fahrer liest Niederlassungen (Anzeige)" "$(als $F "select count(*) from auftraggeber_niederlassungen")" "3"

# ---- Zuordnung an Touren
T1=d0000000-0000-0000-0000-000000000011
als $A "insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, niederlassung_id, startdatum, enddatum, tourenart, rueckfuehrung_stadt, kennzeichen) values ('$T1','Bremen','Hannover','$AGID','$NB','2026-11-03','2026-11-03','ABA','Bremen', array['HB-A 1','H-B 2'])" >/dev/null
pr "Tour für Niederlassung Bremen angelegt" "$(q "select niederlassung_id from touren where id='$T1'")" "$NB"
hat "Niederlassung eines anderen Auftraggebers abgelehnt" "$(als $A "update touren set niederlassung_id='$NX' where id='$T0'")" "NIEDERLASSUNG_FREMD"
hat "Auftraggeberwechsel ohne Zurücksetzen der Niederlassung abgelehnt" "$(als $A "update touren set auftraggeber_id='$AG2' where id='$T1'")" "NIEDERLASSUNG_FREMD"
als $A "update touren set niederlassung_id='$NI' where id='$T0'" >/dev/null
q "update auftraggeber_niederlassungen set aktiv=false where id='$NI'" >/dev/null
hat "Inaktive Niederlassung nicht neu zuweisbar" "$(als $A "update touren set niederlassung_id='$NI' where id='$T1'")" "NIEDERLASSUNG_INAKTIV"
als $A "update touren set info='weiter bearbeitbar' where id='$T0'" >/dev/null
pr "Bestehende Zuordnung zu inaktiver Niederlassung bleibt, Tour weiter bearbeitbar" "$(q "select niederlassung_id||'|'||info from touren where id='$T0'")" "$NI|weiter bearbeitbar"
als $A "update touren set niederlassung_id=null where id='$T0'" >/dev/null
hat "Löschen einer Niederlassung mit Touren nicht möglich" "$(als $A "delete from auftraggeber_niederlassungen where id='$NB'")" "foreign key"
als $A "delete from auftraggeber_niederlassungen where id='$NI'" >/dev/null
pr "Niederlassung ohne Touren/Rechnungen löschbar" "$(q "select count(*) from auftraggeber_niederlassungen where id='$NI'")" "0"

# ---- Rechnung je Niederlassung: Snapshot beim Erstellen
RB=c0000000-0000-0000-0000-000000000011; RH=c0000000-0000-0000-0000-000000000012
als $A "insert into rechnungen (id, auftraggeber_id, niederlassung_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$RB', '$AGID', '$NB', '2026-11-05', '2026-11-03', '2026-11-03', 'entwurf')" >/dev/null
als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$RH', '$AGID', '2026-11-05', '2026-11-03', '2026-11-03', 'entwurf')" >/dev/null
als $A "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, menge, einzelpreis, gesamtpreis, tour_id) values ('$RB', 1, 'Tour Bremen', 1, 100, 100, '$T1')" >/dev/null
als $A "update touren set niederlassung_id=null where id='$T1'; update touren set niederlassung_id='$NB' where id='$T1'" >/dev/null
pr "Tour auf Rechnungs-ENTWURF: Niederlassung noch änderbar" "$(q "select niederlassung_id from touren where id='$T1'")" "$NB"
als $A "update rechnungen set status='offen' where id='$RB'" >/dev/null; als $A "update rechnungen set status='offen' where id='$RH'" >/dev/null
pr "Erstellen mit Niederlassung: E-Rechnungs-Adresse + Käuferreferenz der Niederlassung" "$(q "select erechnung_email||'|'||kaeufer_referenz||'|'||erechnung_format from rechnungen where id='$RB'")" "eingang-bremen@arval.example|REF-BREMEN|en16931_cii"
pr "Erstellen ohne Niederlassung: unverändert die Werte des Auftraggebers" "$(q "select erechnung_email||'|'||kaeufer_referenz from rechnungen where id='$RH'")" "eingang@arval.example|REF-HAUPT"
q "update auftraggeber_niederlassungen set kaeufer_referenz=null where id='$NB'" >/dev/null
RB2=c0000000-0000-0000-0000-000000000013
als $A "insert into rechnungen (id, auftraggeber_id, niederlassung_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$RB2', '$AGID', '$NB', '2026-11-06', '2026-11-03', '2026-11-03', 'offen')" >/dev/null
pr "Leeres Feld der Niederlassung → Wert des Auftraggebers" "$(q "select erechnung_email||'|'||kaeufer_referenz from rechnungen where id='$RB2'")" "eingang-bremen@arval.example|REF-HAUPT"
hat "Tour auf ERSTELLTER Rechnung: Niederlassung gesperrt" "$(als $A "update touren set niederlassung_id=null where id='$T1'")" "NIEDERLASSUNG_ABGERECHNET"
hat "Rechnung mit fremder Niederlassung abgelehnt" "$(als $A "insert into rechnungen (auftraggeber_id, niederlassung_id, datum, leistungszeitraum_von, leistungszeitraum_bis) values ('$AGID', '$NX', '2026-11-05', '2026-11-03', '2026-11-03')")" "NIEDERLASSUNG_FREMD"

# ---- Storno übernimmt die Niederlassung
GS=$(als $A "select rechnung_stornieren('$RB')")
pr "Storno: Stornorechnung mit derselben Niederlassung" "$(q "select niederlassung_id||'|'||art from gutschriften where id='$GS'")" "$NB|storno"
als $A "update touren set niederlassung_id=null where id='$T1'" >/dev/null
pr "Nach Storno: Tour wieder umhängbar" "$(q "select coalesce(niederlassung_id::text,'NULL') from touren where id='$T1'")" "NULL"
als $A "update touren set niederlassung_id='$NB' where id='$T1'" >/dev/null

# ---- Anzeige-Funktion
pr "Anzeige: Hauptsitz = Name · Ort, Niederlassung = Name · Bezeichnung" "$(q "select auftraggeber_anzeige('$AGID', null)||'|'||auftraggeber_anzeige('$AGID', '$NB')")" "Arval · Stuhr|Arval · Bremen"
q "update auftraggeber set hauptsitz_bezeichnung='Stuhr-Moordeich' where id='$AGID'" >/dev/null
pr "Anzeige: eigene Bezeichnung des Hauptsitzes" "$(q "select auftraggeber_anzeige('$AGID', null)")" "Arval · Stuhr-Moordeich"
q "insert into auftraggeber (id, name, ort) values ('00000000-0000-0000-0000-0000000000b9', 'Ohne Filialen KG', 'Oldenburg')" >/dev/null
pr "Anzeige ohne Niederlassungen: nur der Name" "$(q "select auftraggeber_anzeige('00000000-0000-0000-0000-0000000000b9', null)")" "Ohne Filialen KG"

# ---- Tour aufteilen übernimmt die Niederlassung
TS=d0000000-0000-0000-0000-000000000021
als $A "insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, niederlassung_id, startdatum, enddatum, tourenart, rueckfuehrung_stadt, kennzeichen) values ('$TS','Achim','Lüneburg','$AGID','$NB','2026-11-04','2026-11-04','ABA','Achim', array['HB-S 1','LG-S 2'])" >/dev/null
T2=$(als $A "select tour_aufteilen('$TS', '{}'::jsonb) ->> 'neue_tour_id'")
pr "Tour aufteilen: beide Teile mit Niederlassung Bremen" "$(q "select count(*) from touren where id in ('$TS','$T2') and niederlassung_id='$NB'")" "2"

# ---- Auftraggeber-Konto: anlegen/bearbeiten mit Niederlassung, Kundensicht
R=$(als $AGU "select ag_tour_anlegen('{\"start_stadt\":\"Verden\",\"ziel_stadt\":\"Celle\",\"startdatum\":\"2026-11-20\",\"enddatum\":\"2026-11-20\",\"niederlassung_id\":\"$NB\",\"verguetung\":999}'::jsonb)")
TA=$(echo "$R" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
pr "AG-Konto legt Tour mit Niederlassung an (Preis aus dem Payload ignoriert)" "$(q "select niederlassung_id||'|'||coalesce(verguetung::text,'NULL')||'|'||bestaetigt from touren where id='$TA'")" "$NB|NULL|false"
hat "AG-Konto: fremde Niederlassung abgelehnt" "$(als $AGU "select ag_tour_anlegen('{\"start_stadt\":\"A\",\"ziel_stadt\":\"B\",\"startdatum\":\"2026-11-20\",\"enddatum\":\"2026-11-20\",\"niederlassung_id\":\"$NX\"}'::jsonb)")" "NIEDERLASSUNG_FREMD"
pr "Kundensicht: Niederlassung sichtbar, keine Preisspalten" "$(als $AGU "select niederlassung_id from touren_kundensicht where id='$TA'")|$(q "select count(*) from information_schema.columns where table_name='touren_kundensicht' and column_name in ('verguetung','fahrer_honorar','barauslagen')")" "$NB|0"
als $AGU "select ag_tour_aktualisieren('$TA', '{\"niederlassung_id\":null}'::jsonb)" >/dev/null
pr "AG-Konto ändert die Niederlassung (protokolliert)" "$(q "select coalesce(niederlassung_id::text,'NULL') from touren where id='$TA'")|$(q "select count(*) from tour_aenderungen where tour_id='$TA' and feld='niederlassung_id'")" "NULL|1"

echo "FEHLER: $FEHLER"
$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ "$FEHLER" = "0" ]
