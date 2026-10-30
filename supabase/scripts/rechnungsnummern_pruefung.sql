-- Rechnungs- und Gutschriftsnummern prüfen — NUR LESEN, ändert nichts.
--
-- Im Supabase-SQL-Editor ausführen (Abschnitt für Abschnitt oder komplett;
-- jede Abfrage liefert eine eigene Ergebnistabelle). Anlass: seit
-- „Re_26/1000" sortiert die Übersicht die Rechnung hinter die 990er.
-- Geprüft wird, ob auch die Nummernvergabe betroffen ist.

-- 1) Welche Vergabe-Funktion ist in der Datenbank wirklich aktiv?
--    (Repo-Stand: Migration 040/042 — Format 'Re-{Jahr}/{Nr}', Maximum
--    über den Zahlteil, also NUMERISCH. Weicht die Definition hier ab,
--    wurde sie außerhalb der Migrationen geändert.)
select p.proname, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('assign_rechnungsnummer', 'next_rechnungsnummer',
                     'assign_gutschrift_nr', 'next_gutschrift_nr');

-- 2) Trigger auf rechnungen / gutschriften
select event_object_table as tabelle, trigger_name, action_timing, event_manipulation, action_statement
  from information_schema.triggers
 where event_object_schema = 'public' and event_object_table in ('rechnungen', 'gutschriften')
 order by 1, 2;

-- 3) Unique-Constraint / -Index auf den Nummern?
select t.relname as tabelle, i.relname as index, ix.indisunique as eindeutig, pg_get_indexdef(ix.indexrelid) as definition
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class t on t.oid = ix.indrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public' and t.relname in ('rechnungen', 'gutschriften')
   and pg_get_indexdef(ix.indexrelid) ~ '(rechnungsnummer|gutschrift_nr)';

-- 4) Doppelte Rechnungsnummern (exakt) — sollte leer sein
select rechnungsnummer, count(*) as anzahl, string_agg(id::text || ' (' || datum || ', ' || status || ')', '; ') as rechnungen
  from public.rechnungen group by rechnungsnummer having count(*) > 1 order by 1;

-- 4b) Doppelte trotz anderer Schreibweise (Leerzeichen, Groß/klein, „-" vs „_")
select lower(regexp_replace(btrim(rechnungsnummer), '[-_\s]', '', 'g')) as normalisiert,
       count(*) as anzahl, string_agg(rechnungsnummer || ' (' || datum || ')', '; ') as rechnungen
  from public.rechnungen group by 1 having count(*) > 1 order by 1;

-- 5) Doppelte Gutschriftsnummern
select gutschrift_nr, count(*) as anzahl, string_agg(id::text || ' (' || datum || ')', '; ') as gutschriften
  from public.gutschriften group by gutschrift_nr having count(*) > 1 order by 1;

-- 6) Welche Nummern-Formate gibt es? (Präfix = alles vor der laufenden Zahl)
select coalesce((regexp_match(btrim(rechnungsnummer), '^(.*[^0-9])?([0-9]+)$'))[1], '(ohne Zahl am Ende)') as praefix,
       count(*) as anzahl,
       min(datum) as erstes_datum, max(datum) as letztes_datum,
       max(((regexp_match(btrim(rechnungsnummer), '^(.*[^0-9])?([0-9]+)$'))[2])::bigint) as hoechste_nr_numerisch,
       max(rechnungsnummer) as hoechste_nr_als_text
  from public.rechnungen
 group by 1 order by max(datum) desc;

-- 7) Die jüngsten Rechnungen nach Anlage — wurde nach der 1000 weiter hochgezählt?
select rechnungsnummer, datum, status, created_at
  from public.rechnungen order by created_at desc limit 15;

-- 8) Was würde die Datenbank als nächste Nummer vorschlagen? (liest nur)
select public.next_rechnungsnummer(extract(year from current_date)::int) as naechste_rechnungsnummer;
select public.next_gutschrift_nr(extract(year from current_date)::int) as naechste_gutschriftsnummer;
