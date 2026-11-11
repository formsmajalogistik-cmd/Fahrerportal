#!/usr/bin/env bash
# Datenbank-Tests der Migrationen (npm run test:db)
#
# Prüft Trigger, Sperren, RLS und RPCs gegen einen LOKALEN PostgreSQL (≥ 15):
#   1. Vorlage bauen: kleine Supabase-Nachbildung (Rollen, auth.uid(), storage)
#      + alle Migrationen bis 114 + Testnutzer
#   2. je Test eine frische Kopie der Vorlage, darin die Migration(en) einspielen
#      und das Verhalten prüfen
#
# Verbindung siehe gemeinsam.sh (DBTEST_PSQL). Es werden nur Datenbanken mit
# dem Präfix fp_test_ angelegt und wieder gelöscht.
source "$(dirname "${BASH_SOURCE[0]}")/gemeinsam.sh"
if ! $P -d postgres -Atc "select 1" >/dev/null 2>&1; then
  echo "Kein lokaler PostgreSQL erreichbar (psql $DBTEST_PSQL). Verbindung über DBTEST_PSQL setzen."; exit 2
fi
echo "Vorlage bauen (Migrationen bis 114) …"
$P -d postgres -c "drop database if exists $VORLAGE" -c "create database $VORLAGE" >/dev/null 2>&1
$P -d $VORLAGE -v ON_ERROR_STOP=1 -f "$HIER/bootstrap.sql" >/dev/null || { echo "Vorlage: bootstrap.sql fehlgeschlagen"; exit 1; }
for f in $(ls "$M"/*.sql | sort); do
  nr=$(basename "$f" | cut -c1-3)
  [ "$nr" -ge 115 ] 2>/dev/null && continue
  if $P -d $VORLAGE -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -q "ERROR"; then echo "Vorlage: Fehler in $(basename "$f")"; exit 1; fi
done
$P -d $VORLAGE -v ON_ERROR_STOP=1 -f "$HIER/seed.sql" >/dev/null || { echo "Vorlage: seed.sql fehlgeschlagen"; exit 1; }

GESAMT=0
for t in "$HIER"/*.test.sh; do
  echo; echo "== $(sed -n 2p "$t" | sed 's/^# //')"
  bash "$t" || GESAMT=$((GESAMT+1))
done
$P -d postgres -c "drop database if exists $VORLAGE" >/dev/null 2>&1
echo
if [ "$GESAMT" = "0" ]; then echo "Datenbank-Tests: alle bestanden"; else echo "Datenbank-Tests: $GESAMT Datei(en) mit Fehlern"; exit 1; fi
