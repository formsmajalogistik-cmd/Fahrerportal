-- Vorabprüfung für Migration 117 (E-Rechnung Phase 1c) — NUR LESEN.
-- VOR Migration 117 im Supabase-SQL-Editor ausführen.
-- Erwartung: Abfrage 1 = alles „ok", Abfragen 2–4 = keine Zeilen.
-- Abfrage 5 ist nur eine Bestandsübersicht.

-- 1) Voraussetzungen
select t.punkt, case when t.ok then 'ok' else 'FEHLT' end as status
  from (values
    ('Migration 115 eingespielt (rechnungen.faellig_am)',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='rechnungen' and column_name='faellig_am')),
    ('Migration 116 eingespielt (Tabelle erechnung_dokumente)', to_regclass('public.erechnung_dokumente') is not null),
    ('Migration 116: Sperr-Trigger rechnung_sperre', exists (select 1 from pg_trigger where tgname = 'rechnung_sperre')),
    ('Format „zugferd" in der Prüfregel der Archiv-Tabelle vorgesehen',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass('public.erechnung_dokumente') and c.contype = 'c'
                  and pg_get_constraintdef(c.oid) like '%zugferd%')),
    ('Funktion is_admin()', exists (select 1 from pg_proc where proname = 'is_admin')),
    ('Funktion is_test()', exists (select 1 from pg_proc where proname = 'is_test'))
  ) as t(punkt, ok);

-- 2) Spalten/Tabellen, die 117 anlegt, aber schon existieren
--    (kein Fehler — die Migration ist wiederholbar —, aber bitte melden,
--    falls 117 noch nie eingespielt wurde)
select 'erechnung_dokumente' as tabelle, 'protokoll' as spalte
 where exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'erechnung_dokumente' and column_name = 'protokoll')
union all
select 'erechnung_exporte', '(Tabelle)' where to_regclass('public.erechnung_exporte') is not null;

-- 3) Gleichnamige Trigger/Funktionen/Prüfregeln
select 'trigger' as art, tgname as name from pg_trigger where tgname = 'erechnung_exporte_kein_update'
union all
select 'funktion', proname from pg_proc where proname = 'erechnung_exporte_unveraenderlich'
union all
select 'prüfregel', conname from pg_constraint where conname = 'erechnung_dokumente_xml_pfad_check';

-- 4) Archiv-Einträge, die die neue Prüfregel verletzen würden
--    (XML-Pfad leer, obwohl das Format nicht ZUGFeRD ist) — vor 117 kann es
--    solche Zeilen nicht geben, die Spalte ist bis dahin Pflicht.
select id, belegnummer, format from public.erechnung_dokumente
 where xml_pfad is null and format <> 'zugferd';

-- 5) Zur Info: Bestand im Archiv je Format (117 ändert daran nichts)
select format, typ_code, count(*) as eintraege, min(erzeugt_am) as erster, max(erzeugt_am) as letzter
  from public.erechnung_dokumente group by format, typ_code order by format, typ_code;
