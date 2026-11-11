#!/usr/bin/env bash
# Migration 117: ZUGFeRD-Eintrag, Export-Protokoll, Rechnungsnummer im Fehlerpfad
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
DB=fp_test_117
neue_db
$P -d $DB -f $M/115_erechnung_vorbereitung.sql >/dev/null 2>&1
$P -d $DB -f $M/116_erechnung_erzeugung.sql >/dev/null 2>&1
q "update auftraggeber set zahlungsziel_tage=14, erechnung_format='en16931_cii' where id='$AGID'" >/dev/null
# Bestand vor 117: eine archivierte E-Rechnung
R0=c0000000-0000-0000-0000-0000000000a0
q "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$R0', '$AGID', '2026-11-01', '2026-10-01', '2026-10-31', 'offen')" >/dev/null
srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$R0','en16931_cii','380','Re-0','a.xml','a.pdf','2026/a.xml',repeat('a',64),repeat('b',64),10,20)" >/dev/null
VORHER=$(q "select md5(string_agg((id, rechnung_id, format, xml_pfad, pdf_pfad, sha256_xml, erzeugt_am)::text,'|')) from erechnung_dokumente")

for i in 1 2; do out=$($P -d $DB -v ON_ERROR_STOP=1 -f $M/117_erechnung_zugferd_export.sql 2>&1 | grep ERROR); pr "Migration 117 (Lauf $i)" "$out" ""; done
pr "Bestehender Archiv-Eintrag unverändert, protokoll leer" "$(q "select md5(string_agg((id, rechnung_id, format, xml_pfad, pdf_pfad, sha256_xml, erzeugt_am)::text,'|')) from erechnung_dokumente")|$(q "select coalesce(protokoll,'NULL') from erechnung_dokumente")" "$VORHER|NULL"
hat "Archiv bleibt unveränderlich (UPDATE protokoll verboten)" "$(srv "update erechnung_dokumente set protokoll='x'")" "ERECHNUNG_ARCHIV"

# ---- ZUGFeRD-Eintrag: xml_pfad darf leer sein — sonst nicht
RZ=c0000000-0000-0000-0000-0000000000a1
q "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$RZ', '$AGID', '2026-11-01', '2026-10-01', '2026-10-31', 'offen')" >/dev/null
hat "xml_pfad leer bei EN 16931 unzulässig" "$(srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$RZ','en16931_cii','380','Re-z','z.pdf','z',repeat('a',64),repeat('b',64),1,1)")" "erechnung_dokumente_xml_pfad_check"
srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes, protokoll) values ('$RZ','zugferd','380','Re-z','z.pdf','2026/z.pdf',repeat('a',64),repeat('b',64),1,1,'identische Datei übernommen')" >/dev/null
pr "ZUGFeRD-Eintrag ohne XML-Pfad, mit Protokoll-Vermerk" "$(q "select format||'|'||coalesce(xml_pfad,'NULL')||'|'||protokoll from erechnung_dokumente where rechnung_id='$RZ'")" "zugferd|NULL|identische Datei übernommen"
hat "ZUGFeRD-Rechnung ist gesperrt wie jede E-Rechnung" "$(als $A "update rechnungen set datum='2026-12-01' where id='$RZ'")" "ERECHNUNG_GESPERRT"

# ---- Export-Protokoll
DOK=$(q "select id from erechnung_dokumente where rechnung_id='$R0'")
als $A "insert into erechnung_exporte (dokument_id, hash_ok, exportiert_von_name) values ('$DOK', true, 'Ad Min')" >/dev/null
pr "Admin trägt Export ein (exportiert_von = eigener Benutzer)" "$(q "select hash_ok||'|'||exportiert_von from erechnung_exporte")" "true|$A"
hat "Fremder Benutzer als exportiert_von unzulässig" "$(als $A "insert into erechnung_exporte (dokument_id, hash_ok, exportiert_von) values ('$DOK', true, '$F')")" "row-level security"
hat "Test-Rolle darf keinen Export eintragen" "$(als $TE "insert into erechnung_exporte (dokument_id, hash_ok) values ('$DOK', true)")" "row-level security"
hat "Fahrer darf keinen Export eintragen" "$(als $F "insert into erechnung_exporte (dokument_id, hash_ok) values ('$DOK', true)")" "row-level security"
pr "Fahrer sieht kein Export-Protokoll" "$(als $F "select count(*) from erechnung_exporte")" "0"
hat "Export-Protokoll: UPDATE für Admin nicht erlaubt" "$(als $A "update erechnung_exporte set hash_ok=false")" "permission denied"
hat "Export-Protokoll: DELETE für Admin nicht erlaubt" "$(als $A "delete from erechnung_exporte")" "permission denied"
hat "Export-Protokoll: UPDATE auch für Service-Rolle gesperrt (Trigger)" "$(srv "update erechnung_exporte set hash_ok=false")" "ERECHNUNG_EXPORT"
hat "Export-Protokoll: DELETE auch für Service-Rolle gesperrt (Trigger)" "$(srv "delete from erechnung_exporte")" "ERECHNUNG_EXPORT"
hat "Export löscht nichts: Archiv-Eintrag mit Export nicht löschbar" "$(srv "delete from erechnung_dokumente where id='$DOK'")" "ERECHNUNG_ARCHIV"

# ---- Rechnungsnummer bei gescheiterter Erstellung
nr() { q "select rechnungsnummer from rechnungen where id='$1'"; }
zahl() { echo "$1" | grep -o '[0-9]*$'; }
D1=c0000000-0000-0000-0000-0000000000d1; D2=c0000000-0000-0000-0000-0000000000d2; D3=c0000000-0000-0000-0000-0000000000d3
neu() { als $A "insert into rechnungen (id, auftraggeber_id, datum, leistungszeitraum_von, leistungszeitraum_bis, status) values ('$1', '$AGID', '2026-11-03', '2026-10-01', '2026-10-31', 'entwurf')" >/dev/null; }
neu $D1; N1=$(nr $D1)
neu $D2; N2=$(nr $D2)
# Erstellen von D1 … Archiv scheitert … App setzt zurück auf Entwurf
als $A "update rechnungen set status='offen' where id='$D1'" >/dev/null
pr "Während des Erstellens: Nummer unverändert" "$(nr $D1)" "$N1"
als $A "update rechnungen set status='entwurf', faellig_am=null, absender_snapshot=null where id='$D1'" >/dev/null
pr "Zurück im Entwurf: dieselbe Nummer, Snapshot/Fälligkeit geleert" "$(nr $D1)|$(q "select status||'|'||coalesce(faellig_am::text,'NULL')||'|'||coalesce(absender_snapshot::text,'NULL') from rechnungen where id='$D1'")" "$N1|entwurf|NULL|NULL"
neu $D3; N3=$(nr $D3)
pr "Nächste neue Rechnung: fortlaufend, keine Wiedervergabe der Nummer des Entwurfs" "$(( $(zahl $N2) - $(zahl $N1) ))|$(( $(zahl $N3) - $(zahl $N2) ))" "1|1"
# Erneuter Versuch gelingt
als $A "update rechnungen set status='offen' where id='$D1'" >/dev/null
srv "insert into erechnung_dokumente (rechnung_id, format, typ_code, belegnummer, xml_pfad, pdf_pfad, bucket_pfad, sha256_xml, sha256_pdf, xml_bytes, pdf_bytes) values ('$D1','en16931_cii','380','$N1','d1.xml','d1.pdf','2026/d1.xml',repeat('a',64),repeat('b',64),1,1)" >/dev/null
pr "Erneuter Versuch: erstellt mit derselben Nummer, Snapshot neu gesetzt" "$(nr $D1)|$(q "select status||'|'||(absender_snapshot is not null)||'|'||faellig_am from rechnungen where id='$D1'")" "$N1|offen|true|2026-11-17"
pr "Keine Doppelvergabe: alle Nummern eindeutig" "$(q "select count(*) - count(distinct rechnungsnummer) from rechnungen")" "0"
hat "Nach Erfolg kein Zurück auf Entwurf mehr (Sperre)" "$(als $A "update rechnungen set status='entwurf', faellig_am=null, absender_snapshot=null where id='$D1'")" "ERECHNUNG_GESPERRT"
hat "Nummer einer E-Rechnung nicht mehr änderbar" "$(als $A "update rechnungen set rechnungsnummer='Re-9999' where id='$D1'")" "ERECHNUNG_GESPERRT"
echo "FEHLER: $FEHLER"
$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ "$FEHLER" = "0" ]
