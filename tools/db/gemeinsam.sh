# Gemeinsame Helfer der Datenbank-Tests (wird von lauf.sh und den Tests eingelesen).
#
# Verbindung: Standard ist ein lokaler PostgreSQL über Unix-Socket. Anpassen mit
#   DBTEST_PSQL="-h localhost -p 5432 -U postgres"
# Die Tests legen eigene Datenbanken an (fp_test_*) und löschen sie wieder —
# NIEMALS auf die echte (Supabase-)Datenbank zeigen lassen.
DBTEST_PSQL="${DBTEST_PSQL:--h /tmp -p 5463 -U postgres}"
case "$DBTEST_PSQL" in *supabase*|*pooler*) echo "Abbruch: Die Tests laufen nur gegen eine lokale Wegwerf-Datenbank."; exit 2;; esac
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
M="$HIER/../../supabase/migrations"
VORLAGE=fp_test_vorlage
P="psql $DBTEST_PSQL -q"
FEHLER=0
q()   { psql $DBTEST_PSQL -Atq -d "$DB" -c "$1" 2>&1; }
# als <Benutzer-ID> <SQL>: als angemeldeter Nutzer (Rolle authenticated, RLS aktiv)
als() { psql $DBTEST_PSQL -Atq -d "$DB" -c "begin; set local role authenticated; set local test.uid='$1'; $2; commit;" 2>&1 | grep -v '^BEGIN$\|^COMMIT$\|^SET$'; }
# srv <SQL>: als Server (service_role, umgeht RLS — wie die Vercel-Functions)
srv() { psql $DBTEST_PSQL -Atq -d "$DB" -c "begin; set local role service_role; $1; commit;" 2>&1 | grep -v '^BEGIN$\|^COMMIT$\|^SET$'; }
pr()  { if [ "$2" == "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1"; echo "        ist:  $2"; echo "        soll: $3"; FEHLER=$((FEHLER+1)); fi; }
hat() { if echo "$2" | grep -q "$3"; then echo "  ok    $1"; else echo "  FAIL  $1"; echo "        ist:  $2"; echo "        soll: …$3…"; FEHLER=$((FEHLER+1)); fi; }
neue_db() { $P -d postgres -c "drop database if exists $DB" -c "create database $DB template $VORLAGE" >/dev/null 2>&1; }
# Testnutzer aus seed.sql
A=00000000-0000-0000-0000-0000000000a1; F=00000000-0000-0000-0000-0000000000f1; TE=00000000-0000-0000-0000-0000000000e1
AGID=00000000-0000-0000-0000-0000000000a9; FID=0000000f-0000-0000-0000-000000000001
