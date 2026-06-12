# Migrations-Regeln

Verbindliche Regeln für alle neuen Migrationen in diesem Projekt:

1. **Schema NIE raten — immer prüfen.** Vor dem Schreiben einer
   Migration die echten Tabellen-/Spaltennamen ermitteln:
   - In Supabase:
     ```sql
     select table_name from information_schema.tables
     where table_schema = 'public' order by table_name;
     ```
   - Oder lokal die Migrations-Historie lesen — dabei auch auf
     spätere `drop table` / `drop column` achten:
     ```bash
     grep -rn "create table\|drop table" supabase/migrations/*.sql
     ```
   - Abgleich mit dem Frontend (welche Tabellen werden wirklich genutzt):
     ```bash
     grep -rhoP "from\('[^']+'\)" src --include="*.ts" --include="*.tsx" | sort -u
     ```
   Bekannte Falle: `formular_zuweisungen` wurde in Migration 023
   gedroppt — die aktive Zuweisungs-Tabelle ist
   `tour_protokoll_zuweisungen` (Migration 054).

2. **Idempotent schreiben.** `add column if not exists`,
   `drop policy if exists` + `create policy`,
   `create or replace function`, `drop view if exists` + `create view`,
   `create table if not exists`. Eine teilweise gelaufene Migration
   muss beim Re-Run sauber durchlaufen.

3. **Reihenfolge innerhalb einer Datei:** erst `alter table ... add
   column`, dann neue Tabellen, dann Funktionen (Postgres validiert
   SQL-Funktions-Bodies beim CREATE), dann Views, dann Policies/RPCs.

4. **Enum-Werte separat.** `alter type ... add value` in eine eigene
   Migration — der neue Wert darf nicht in derselben Transaktion
   benutzt werden.

5. **Am Ende:** `notify pgrst, 'reload schema';` damit PostgREST die
   Änderungen sofort sieht.

6. **Rollen-Modell:** Die Nutzer-Rolle liegt auf `app_users.role`
   (Enum `user_role`: admin / fahrer / auftraggeber / test) — NICHT
   auf der `fahrer`-Tabelle. `fahrer` ist das Fahrer-Profil
   (1:n zu app_users über Unterkonten).
