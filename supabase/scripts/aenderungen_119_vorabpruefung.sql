-- Vorabprüfung für Migration 119 (Änderungsanzeige nur bei bestätigten
-- Aufträgen, Bestätigen mit Versionsprüfung) — NUR LESEN.
-- VOR Migration 119 im Supabase-SQL-Editor ausführen.
-- Erwartung: Abfrage 1 = alles „ok", Abfrage 2 = keine Zeilen.
-- Abfragen 3 und 4 sind Übersichten (zur Info).

-- 1) Voraussetzungen
select t.punkt, case when t.ok then 'ok' else 'FEHLT' end as status
  from (values
    ('Tabelle tour_aenderungen mit Spalte quelle (Migration 105)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tour_aenderungen' and column_name='quelle')),
    ('touren.updated_at + Trigger touren_updated_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='touren' and column_name='updated_at') and exists (select 1 from pg_trigger where tgname='touren_updated_at')),
    ('Funktionen is_admin() / is_test()', exists (select 1 from pg_proc where proname='is_admin') and exists (select 1 from pg_proc where proname='is_test')),
    ('PostgreSQL ≥ 15 (Views mit security_invoker)', current_setting('server_version_num')::int >= 150000)
  ) as t(punkt, ok);

-- 2) Was 119 anlegt, aber schon existiert (bitte melden, falls 119 noch nie lief)
select 'spalte' as art, 'tour_aenderungen.vor_bestaetigung' as name
 where exists (select 1 from information_schema.columns where table_schema='public' and table_name='tour_aenderungen' and column_name='vor_bestaetigung')
union all
select 'view', 'tour_aenderungen_offen' where to_regclass('public.tour_aenderungen_offen') is not null
union all
select 'trigger', tgname from pg_trigger where tgname in ('tour_aenderungen_vor_bestaetigung', 'touren_bestaetigt_alte_aenderungen', 'tour_aenderungen_stand_setzen')
union all
select 'funktion', proname from pg_proc where proname in ('tour_bestaetigen', 'tour_aenderung_vor_bestaetigung', 'tour_bestaetigt_alte_aenderungen', 'tour_aenderung_stand_setzen');

-- 3) Offene Einträge, die nach 119 AUSGEBLENDET werden (Tour noch nicht
--    bestätigt). Sie werden nicht gelöscht und bleiben im Protokoll der Tour.
select t.tour_id as tour_nr, t.abgelehnt, count(*) as offene_eintraege, min(a.geaendert_am) as erster, max(a.geaendert_am) as letzter
  from tour_aenderungen a join touren t on t.id = a.tour_id
 where a.gesehen_am is null and not t.bestaetigt
 group by t.tour_id, t.abgelehnt
 order by letzter desc;

-- 4) Offene Einträge, die weiter angezeigt werden (bestätigte Touren)
select count(*) as offene_eintraege_bestaetigt, count(distinct a.tour_id) as touren
  from tour_aenderungen a join touren t on t.id = a.tour_id
 where a.gesehen_am is null and t.bestaetigt;
