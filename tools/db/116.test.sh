#!/usr/bin/env bash
# Migration 116: Snapshot, Archiv, Sperren, Storno
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_116
T1=d1000000-0000-0000-0000-000000000001
neue_db
$P -d $DB -f $M/115_erechnung_vorbereitung.sql >/dev/null 2>&1
q "update auftraggeber set zahlungsziel_tage=14, erechnung_format='pdf' where id='$AGID'" >/dev/null
q "insert into touren (id, tour_id, start_stadt, ziel_stadt, auftraggeber_id, fahrer_id, startdatum, enddatum, tourenart, kennzeichen, verguetung)
   values ('$T1','T-1','Bremen','Kiel','$AGID','$FID','2026-10-13','2026-10-15','AB', array['HB-1'], 200)" >/dev/null
# Bestand vor 116: erstellte Rechnung mit Position, Gutschrift
q "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status, netto_summe, ust_satz, ust_betrag, brutto_summe)
   values ('c0000000-0000-0000-0000-000000000001', '$AGID', '2026-10-20', '2026-10-01', '2026-10-31', 'offen', 200, 19, 38, 238)" >/dev/null
q "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, menge, einzelpreis, gesamtpreis, tour_id) values ('c0000000-0000-0000-0000-000000000001', 1, 'Alt', 1, 200, 200, '$T1')" >/dev/null
q "insert into gutschriften (id, datum, status, netto_summe) values ('e0000000-0000-0000-0000-000000000001', '2026-10-21', 'final', 10)" >/dev/null
HASH="select md5(string_agg(x,'|' order by x)) from (select (id, rechnungsnummer, datum, status, netto_summe, ust_betrag, brutto_summe, faellig_am)::text x from rechnungen union all select (id, bezeichnung, gesamtpreis, tour_id)::text from rechnungspositionen union all select (id, gutschrift_nr, status, netto_summe)::text from gutschriften) s"
VORHER=$(q "$HASH")

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/116_erechnung_erzeugung.sql 2>&1 | grep ERROR); pr "Migration 116 (Lauf $i)" "$out" ""; done
pr "Bestand unverändert (Rechnungen, Positionen, Gutschriften)" "$(q "$HASH")" "$VORHER"
pr "Bestand: kein Snapshot, kein Leistungsdatum nachträglich" "$(q "select count(*) from rechnungen where absender_snapshot is not null")|$(q "select count(*) from rechnungspositionen where leistungsdatum is not null")|$(q "select count(*) from gutschriften where absender_snapshot is not null")" "0|0|0"
pr "Firmendaten-Einstellung angelegt" "$(q "select value->>'firmenname' from app_settings where key='firmendaten'")" "Maja-Logistik M.Janßen"
q "update app_settings set value = value || '{\"ort\":\"Stuhr\"}' where key='firmendaten'" >/dev/null
$P -d $DB -f $M/116_erechnung_erzeugung.sql >/dev/null 2>&1
pr "Erneuter Lauf überschreibt geänderte Firmendaten nicht" "$(q "select value->>'ort' from app_settings where key='firmendaten'")" "Stuhr"

# ---- Neue Rechnung: Entwurf → erstellt
R2=c0000000-0000-0000-0000-000000000002
als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status, netto_summe, ust_satz, ust_betrag, brutto_summe) values ('$R2', '$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'entwurf', 300, 19, 57, 357)" >/dev/null
als $A "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, menge, einzelpreis, gesamtpreis, tour_id) values ('$R2', 1, 'Tour', 1, 200, 200, '$T1'), ('$R2', 2, 'Manuell', 1, 100, 100, null)" >/dev/null
pr "Leistungsdatum beim Anlegen = Enddatum der Tour; manuelle Position leer" "$(q "select string_agg(coalesce(leistungsdatum::text,'-'),',' order by position_nr) from rechnungspositionen where rechnung_id='$R2'")" "2026-10-15,-"
q "update touren set enddatum='2026-10-16' where id='$T1'" >/dev/null
q "update auftraggeber set erechnung_format='xrechnung_cii', kaeufer_referenz='LW-1' where id='$AGID'" >/dev/null
pr "Entwurf: noch kein Snapshot" "$(q "select coalesce(absender_snapshot::text,'NULL') from rechnungen where id='$R2'")" "NULL"
als $A "update rechnungen set status='offen' where id='$R2'" >/dev/null
pr "Erstellen: Snapshot, Format/Referenz aus Auftraggeber, Fälligkeit" "$(q "select (absender_snapshot->>'ort')||'|'||erechnung_format||'|'||kaeufer_referenz||'|'||faellig_am from rechnungen where id='$R2'")" "Stuhr|xrechnung_cii|LW-1|2026-11-17"
pr "Erstellen: Leistungsdatum aufgefrischt (Tour geändert)" "$(q "select leistungsdatum from rechnungspositionen where rechnung_id='$R2' and position_nr=1")" "2026-10-16"
q "update app_settings set value = value || '{\"ort\":\"Neuort\"}' where key='firmendaten'" >/dev/null
pr "Spätere Einstellungsänderung ändert den Snapshot nicht" "$(q "select absender_snapshot->>'ort' from rechnungen where id='$R2'")" "Stuhr"

# ---- Archiv-Tabelle
pr "Admin darf NICHT selbst einfügen" "$(als $A "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$R2','xrechnung_cii','380','x','a','b','c',repeat('a',64),repeat('b',64),1,1)" | grep -c 'permission denied')" "1"
srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$R2','xrechnung_cii','380','Re-1','a.xml','a.pdf','2026/a.xml',repeat('a',64),repeat('b',64),10,20)" >/dev/null
pr "Server (Service-Rolle) fügt ein; Admin liest, Fahrer nicht" "$(als $A "select count(*) from erechnung_dokumente")|$(als $F "select count(*) from erechnung_dokumente")" "1|0"
hat "Archiv: UPDATE verboten (auch Service-Rolle)" "$(srv "update erechnung_dokumente set sha256_xml=repeat('c',64)")" "ERECHNUNG_ARCHIV"
hat "Archiv: DELETE verboten (auch Service-Rolle)" "$(srv "delete from erechnung_dokumente")" "ERECHNUNG_ARCHIV"
hat "Archiv: zweite Version 1 nicht möglich" "$(srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$R2','xrechnung_cii','380','Re-1','a','b','c',repeat('a',64),repeat('b',64),1,1)")" "duplicate key"

# ---- Sperre
hat "Gesperrt: Datum ändern" "$(als $A "update rechnungen set datum='2026-11-04' where id='$R2'")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: Beträge ändern" "$(als $A "update rechnungen set brutto_summe=1 where id='$R2'")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: Position ändern" "$(als $A "update rechnungspositionen set gesamtpreis=1 where rechnung_id='$R2'")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: Position hinzufügen" "$(als $A "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis) values ('$R2', 3, 'x', 1, 1)")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: Position löschen" "$(als $A "delete from rechnungspositionen where rechnung_id='$R2'")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: Rechnung löschen" "$(als $A "delete from rechnungen where id='$R2'")" "ERECHNUNG_GESPERRT"
hat "Gesperrt: zurück auf Entwurf" "$(als $A "update rechnungen set status='entwurf' where id='$R2'")" "ERECHNUNG_GESPERRT"
als $A "update rechnungen set status='bezahlt', bezahlt_am='2026-11-20', notizen='Zahlung eingegangen' where id='$R2'" >/dev/null
pr "Erlaubt: bezahlt + Notiz" "$(q "select status||'|'||bezahlt_am||'|'||notizen from rechnungen where id='$R2'")" "bezahlt|2026-11-20|Zahlung eingegangen"
als $A "update rechnungen set status='offen', bezahlt_am=null where id='$R2'" >/dev/null
als $A "update rechnungen set pdf_url='Maja-Logistik/E-Rechnungen/2026/a.pdf', email_versendet_am=now() where id='$R2'" >/dev/null
pr "Erlaubt: zurück auf offen, PDF-Pfad erstmals setzen, Versand-Zeitpunkt" "$(q "select status||'|'||pdf_url||'|'||(email_versendet_am is not null) from rechnungen where id='$R2'")" "offen|Maja-Logistik/E-Rechnungen/2026/a.pdf|true"
hat "Gesperrt: PDF-Pfad überschreiben" "$(als $A "update rechnungen set pdf_url='x.pdf' where id='$R2'")" "ERECHNUNG_GESPERRT"
# PDF-Rechnung ohne E-Rechnung: wie bisher frei
R3=c0000000-0000-0000-0000-000000000003
als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$R3', '$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'offen')" >/dev/null
als $A "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis) values ('$R3', 1, 'x', 10, 10)" >/dev/null
als $A "update rechnungen set datum='2026-11-04' where id='$R3'" >/dev/null
als $A "update rechnungspositionen set gesamtpreis=11, einzelpreis=11 where rechnung_id='$R3'" >/dev/null
pr "PDF-Rechnung: Datum + Positionen weiter änderbar" "$(q "select datum from rechnungen where id='$R3'")|$(q "select gesamtpreis from rechnungspositionen where rechnung_id='$R3'")" "2026-11-04|11.00"
als $A "delete from rechnungen where id='$R3'" >/dev/null
pr "PDF-Rechnung: weiterhin löschbar" "$(q "select count(*) from rechnungen where id='$R3'")" "0"

# ---- Storno
pr "Test-Rolle darf nicht stornieren" "$(als $TE "select rechnung_stornieren('$R2')" | grep -c NUR_ADMIN)" "1"
hat "Entwurf kann nicht storniert werden" "$(als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('c0000000-0000-0000-0000-000000000004', '$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'entwurf'); select rechnung_stornieren('c0000000-0000-0000-0000-000000000004')")" "STORNO_NICHT_MOEGLICH"
GS=$(als $A "select rechnung_stornieren('$R2')")
pr "Storno: Original storniert (trotz Sperre erlaubt)" "$(q "select status||'|'||(storniert_am is not null) from rechnungen where id='$R2'")" "storniert|true"
pr "Storno: Stornorechnung final, Bezug, Beträge, Format, Snapshot" "$(q "select art||'|'||status||'|'||bezug_rechnungsnummer||'|'||bezug_rechnungsdatum||'|'||brutto_summe||'|'||erechnung_format||'|'||kaeufer_referenz||'|'||(absender_snapshot->>'ort') from gutschriften where id='$GS'")" "storno|final|$(q "select rechnungsnummer from rechnungen where id='$R2'")|2026-11-03|357.00|xrechnung_cii|LW-1|Neuort"
pr "Storno: Positionen positiv kopiert, Leistungsdatum wie Original" "$(q "select string_agg(bezeichnung||':'||einzelpreis||':'||coalesce(leistungsdatum::text,'-'),',' order by position_nr) from gutschriftspositionen where gutschrift_id='$GS'")" "Tour:200.00:2026-10-16,Manuell:100.00:-"
hat "Storno: zweites Mal nicht möglich" "$(als $A "select rechnung_stornieren('$R2')")" "STORNO_NICHT_MOEGLICH"
hat "Storniert: nicht zurück auf offen" "$(als $A "update rechnungen set status='offen' where id='$R2'")" "ERECHNUNG_GESPERRT"
# Storno einer PDF-Rechnung
R5=c0000000-0000-0000-0000-000000000005
als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status, brutto_summe) values ('$R5', '$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'offen', 50)" >/dev/null
als $A "insert into rechnungspositionen (rechnung_id, position_nr, bezeichnung, einzelpreis, gesamtpreis) values ('$R5', 1, 'x', 50, 50)" >/dev/null
als $A "select rechnung_stornieren('$R5')" >/dev/null
hat "PDF-Rechnung storniert: nicht löschbar" "$(als $A "delete from rechnungen where id='$R5'")" "STORNO_BEZUG"
hat "PDF-Rechnung storniert: nicht mehr änderbar" "$(als $A "update rechnungen set datum='2026-12-01' where id='$R5'")" "STORNIERT"
hat "PDF-Rechnung storniert: Positionen gesperrt" "$(als $A "update rechnungspositionen set gesamtpreis=1 where rechnung_id='$R5'")" "STORNIERT"
als $A "update rechnungen set notizen='intern' where id='$R5'" >/dev/null
pr "PDF-Rechnung storniert: interne Notiz bleibt möglich" "$(q "select notizen from rechnungen where id='$R5'")" "intern"

# ---- Gutschriften
hat "Teilgutschrift ohne Rechnungsbezug unzulässig" "$(als $A "insert into gutschriften (art, datum) values ('teilgutschrift', current_date)")" "gutschriften_art_bezug_check"
G2=$(als $A "insert into gutschriften (art, rechnung_id, datum, status) values ('teilgutschrift', '$R5', current_date, 'entwurf') returning id")
pr "Teilgutschrift-Entwurf: kein Snapshot" "$(q "select coalesce(absender_snapshot::text,'NULL') from gutschriften where id='$G2'")" "NULL"
als $A "update gutschriften set status='final' where id='$G2'" >/dev/null
pr "Gutschrift final: Snapshot gesetzt" "$(q "select absender_snapshot->>'ort' from gutschriften where id='$G2'")" "Neuort"
srv "insert into erechnung_dokumente (gutschrift_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$GS','xrechnung_cii','381','GS-1','g.xml','g.pdf','g',repeat('a',64),repeat('b',64),1,1)" >/dev/null
hat "Gutschrift mit E-Rechnung: nicht änderbar" "$(als $A "update gutschriften set datum='2026-12-01' where id='$GS'")" "ERECHNUNG_GESPERRT"
hat "Gutschrift mit E-Rechnung: nicht löschbar" "$(als $A "delete from gutschriften where id='$GS'")" "ERECHNUNG_GESPERRT"
hat "Gutschrift mit E-Rechnung: Positionen gesperrt" "$(als $A "delete from gutschriftspositionen where gutschrift_id='$GS'")" "ERECHNUNG_GESPERRT"
als $A "update gutschriften set interne_notizen='ok', email_versendet_am=now() where id='$GS'" >/dev/null
pr "Gutschrift mit E-Rechnung: Notiz/Versand erlaubt" "$(q "select interne_notizen from gutschriften where id='$GS'")" "ok"

# ---- Sonstiges
pr "Bucket 'erechnung' privat" "$(q "select public from storage.buckets where id='erechnung'")" "f"
pr "Format en16931_cii erlaubt" "$(q "update auftraggeber set erechnung_format='en16931_cii' where id='$AGID' returning erechnung_format")" "en16931_cii"
pr "Fahrer sieht weiterhin keine Rechnungen/Gutschriften" "$(als $F "select count(*) from rechnungen")|$(als $F "select count(*) from gutschriften")" "0|0"
echo "FEHLER: $FEHLER"
# ---- Stornorechnung (PDF) endgültig
GS5=$(q "select id from gutschriften where rechnung_id='$R5' and art='storno'")
hat "PDF-Storno: nicht löschbar" "$(als $A "delete from gutschriften where id='$GS5'")" "STORNO_ENDGUELTIG"
hat "PDF-Storno: nicht zurück auf Entwurf" "$(als $A "update gutschriften set status='entwurf' where id='$GS5'")" "STORNO_ENDGUELTIG"
hat "PDF-Storno: Positionen gesperrt" "$(als $A "update gutschriftspositionen set gesamtpreis=1 where gutschrift_id='$GS5'")" "STORNO_ENDGUELTIG"
als $A "update gutschriften set pdf_url='x.pdf', mit_stempel=false where id='$GS5'" >/dev/null
pr "PDF-Storno: PDF-Pfad/Stempel änderbar" "$(q "select pdf_url||mit_stempel from gutschriften where id='$GS5'")" "x.pdffalse"
pr "PDF-Storno: Positionen vorhanden + final + Snapshot" "$(q "select count(*) from gutschriftspositionen where gutschrift_id='$GS5'")|$(q "select status||(absender_snapshot is not null) from gutschriften where id='$GS5'")" "1|finaltrue"
echo "FEHLER: $FEHLER"
$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ "$FEHLER" = "0" ]
