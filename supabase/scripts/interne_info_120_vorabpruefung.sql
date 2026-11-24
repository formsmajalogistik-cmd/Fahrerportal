-- Vorabprüfung für Migration 120 (Interne Info nur Admin + Leerfahrt mit
-- Grund) — NUR LESEN.
-- VOR Migration 120 im Supabase-SQL-Editor ausführen (nach 119).
-- Erwartung: Abfrage 1 = alles „ok", Abfragen 2 und 3 = keine Zeilen.
-- Abfrage 4 ist eine Übersicht (zur Info).

-- 1) Voraussetzungen
select t.punkt, case when t.ok then 'ok' else 'FEHLT' end as status
  from (values
    ('Migration 114 (tour_leerfahrt, tour_leerfahrt_setzen, leerfahrt_protokoll)', to_regclass('public.tour_leerfahrt') is not null and exists (select 1 from pg_proc where proname='tour_leerfahrt_setzen') and exists (select 1 from pg_proc where proname='leerfahrt_protokoll')),
    ('Migration 106 (tour_aufteilungen)', to_regclass('public.tour_aufteilungen') is not null),
    ('Migration 119 (View tour_aenderungen_offen)', to_regclass('public.tour_aenderungen_offen') is not null),
    ('Funktionen is_admin() / is_test()', exists (select 1 from pg_proc where proname='is_admin') and exists (select 1 from pg_proc where proname='is_test'))
  ) as t(punkt, ok);

-- 2) Was 120 anlegt, aber schon existiert (bitte melden, falls 120 noch nie lief)
select 'tabelle' as art, 'touren_admin_info' as name where to_regclass('public.touren_admin_info') is not null
union all
select 'trigger', tgname from pg_trigger where tgname in ('touren_admin_info_stempel', 'touren_admin_info_protokoll', 'admin_info_aufteilung')
union all
select 'funktion', proname from pg_proc where proname in ('tour_leerfahrt_mit_grund', 'touren_admin_info_stempel', 'touren_admin_info_protokoll',
  'admin_info_bei_aufteilung', 'info_zeile_index', 'info_zeile_setzen');

-- 3) Spalten mit gleichem Namen an touren (darf es nicht geben — die Felder
--    gehören bewusst NICHT in die für Fahrer/Auftraggeber lesbare Tabelle)
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'touren'
   and column_name in ('interne_info', 'leerfahrt_grund', 'leerfahrt_text', 'leerfahrt_zeile');

-- 4) Übersicht: bestehende Leerfahrten (bekommen KEINEN Grund nachgetragen;
--    beim nächsten Klick auf „Leerfahrt" kann ein Grund gewählt werden)
select count(*) as leerfahrten_bisher from tour_leerfahrt;
