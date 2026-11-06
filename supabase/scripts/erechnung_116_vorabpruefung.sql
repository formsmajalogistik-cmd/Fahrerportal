-- Vorabprüfung für Migration 116 (E-Rechnung Phase 1b) — NUR LESEN.
-- VOR Migration 116 im Supabase-SQL-Editor ausführen.
-- Erwartung: Abfrage 1 = alles „ok", Abfragen 2–5 = keine Zeilen.

-- 1) Voraussetzungen
select t.punkt, case when t.ok then 'ok' else 'FEHLT' end as status
  from (values
    ('Migration 115 eingespielt (rechnungen.faellig_am)',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='rechnungen' and column_name='faellig_am')),
    ('Tabelle gutschriften', to_regclass('public.gutschriften') is not null),
    ('Tabelle gutschriftspositionen', to_regclass('public.gutschriftspositionen') is not null),
    ('Tabelle app_settings', to_regclass('public.app_settings') is not null),
    ('Schema storage (Buckets)', to_regclass('storage.buckets') is not null),
    ('Funktion is_admin()', exists (select 1 from pg_proc where proname = 'is_admin')),
    ('Funktion is_test()', exists (select 1 from pg_proc where proname = 'is_test')),
    ('Rolle service_role', exists (select 1 from pg_roles where rolname = 'service_role'))
  ) as t(punkt, ok);

-- 2) Rechnungen mit Status außerhalb von entwurf/offen/bezahlt (würden den
--    neuen Status-Check nicht stören, aber bitte melden)
select status, count(*) from public.rechnungen
 where status not in ('entwurf', 'offen', 'bezahlt') group by status;

-- 3) Spalten/Tabellen, die 116 anlegt, aber schon existieren
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('rechnungen','storniert_am'), ('rechnungen','absender_snapshot'),
     ('gutschriften','absender_snapshot'), ('gutschriften','art'), ('gutschriften','bezug_rechnungsnummer'),
     ('gutschriften','bezug_rechnungsdatum'), ('gutschriften','erechnung_format'),
     ('gutschriften','erechnung_email'), ('gutschriften','kaeufer_referenz'),
     ('rechnungspositionen','leistungsdatum'), ('gutschriftspositionen','leistungsdatum'))
union all
select 'erechnung_dokumente', '(Tabelle)' where to_regclass('public.erechnung_dokumente') is not null;

-- 4) Gleichnamige Trigger/Funktionen
select 'trigger' as art, tgname as name from pg_trigger
 where tgname in ('rechnung_erstellen_snapshot', 'rechnung_erstellen_leistungsdaten', 'rechnung_sperre',
                  'rechnungsposition_sperre', 'gutschrift_sperre', 'gutschriftsposition_sperre',
                  'gutschrift_final_snapshot', 'rechnungspositionen_leistungsdatum', 'gutschriftspositionen_leistungsdatum')
union all
select 'funktion', proname from pg_proc
 where proname in ('rechnung_stornieren', 'rechnung_hat_erechnung', 'gutschrift_hat_erechnung', 'rechnung_sperre');

-- 5) Schon vorhandener Einstellungs-Schlüssel / Bucket
select 'app_settings' as wo, key from public.app_settings where key = 'firmendaten'
union all
select 'storage.buckets', id from storage.buckets where id = 'erechnung';

-- 6) Zur Info: Region / Projekt (die Region selbst steht im Supabase-
--    Dashboard unter Project Settings → General; hier nur der Server)
select current_setting('server_version') as postgres_version, inet_server_addr() as server_adresse;
