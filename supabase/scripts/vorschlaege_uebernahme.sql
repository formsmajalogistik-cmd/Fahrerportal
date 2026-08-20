-- ============================================================
-- Vorschlags-Pool nachträglich befüllen — ÜBERNAHME
-- ------------------------------------------------------------
-- Erst nach Freigabe und nach dem Trockenlauf ausführen.
-- Liegt bewusst unter scripts/ und läuft NICHT mit den Migrationen.
--
-- Regeln wie im laufenden Betrieb:
--   * Werte unter 3 und über 200 Zeichen fallen weg
--   * Mehrfach-Leerzeichen zusammengezogen
--   * Groß-/Kleinschreibung zählt als derselbe Wert; die zuerst
--     gefundene Schreibweise gewinnt
--   * bereits vorhandene Werte werden nicht verdoppelt, sondern in
--     `anzahl` hochgezählt
--   * ist_manuell bleibt false — das sind gesammelte, keine gepflegten
--     Werte
--
-- WICHTIG: Erst UPDATE, dann INSERT. Andersherum würde der UPDATE die
-- soeben eingefügten Zeilen ein zweites Mal hochzählen.
--
-- Schutz gegen Doppellauf über vorschlaege_backfill_log.
-- ============================================================

begin;

create table if not exists public.vorschlaege_backfill_log (
  gelaufen_am timestamptz primary key default now(),
  eintraege   int
);

do $$
begin
  if exists (select 1 from public.vorschlaege_backfill_log) then
    raise exception
      'Die Übernahme lief bereits (siehe vorschlaege_backfill_log). Zum Wiederholen die Tabelle leeren.';
  end if;
end $$;

-- 1) Bestehende Werte hochzählen.
with roh as (
  -- 1) Adressfelder aus eingereichten Formularen. Jedes Feld vom Typ
  --    "address" im Template-Schema liefert drei Werte.
  select 'adresse_strasse' as feld_typ, f.daten -> (fld ->> 'id') ->> 'strasse' as wert
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  select 'adresse_plz', f.daten -> (fld ->> 'id') ->> 'plz'
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  select 'adresse_stadt', f.daten -> (fld ->> 'id') ->> 'stadt'
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  -- 2) Tour-Adressfelder (Migration 086/087).
  select 'adresse_strasse', t.strasse_start from public.touren t
  union all select 'adresse_strasse', t.strasse_ziel from public.touren t
  union all select 'adresse_strasse', t.strasse_rueckfuehrung from public.touren t
  union all select 'adresse_plz', t.plz_start from public.touren t
  union all select 'adresse_plz', t.plz_ziel from public.touren t
  union all select 'adresse_plz', t.plz_rueckfuehrung from public.touren t
  union all select 'adresse_stadt', t.start_stadt from public.touren t
  union all select 'adresse_stadt', t.ziel_stadt from public.touren t
  union all select 'adresse_stadt', t.rueckfuehrung_stadt from public.touren t
  union all
  -- 3) Fahrzeugmodell und Kundenname aus den Touren.
  select 'fahrzeugmodell', t.fahrzeugmodell from public.touren t
  union all select 'fahrzeugmodell', t.fahrzeugmodell_rueck from public.touren t
  union all select 'firma', t.kundenname from public.touren t
),
sauber as (
  select feld_typ,
         btrim(regexp_replace(wert, '\s+', ' ', 'g')) as wert
    from roh
   where wert is not null
),
gefiltert as (
  select feld_typ, wert
    from sauber
   where char_length(wert) between 3 and 200
),
gruppiert as (
  select feld_typ, lower(wert) as schluessel,
         min(wert) as schreibweise, count(*) as anzahl
    from gefiltert
   group by feld_typ, lower(wert)
)
update public.feld_vorschlaege fv
   set anzahl = fv.anzahl + g.anzahl,
       letzte_nutzung = now()
  from gruppiert g
 where fv.feld_typ = g.feld_typ
   and lower(fv.wert) = g.schluessel;

-- 2) Danach die wirklich neuen anlegen.
with roh as (
  -- 1) Adressfelder aus eingereichten Formularen. Jedes Feld vom Typ
  --    "address" im Template-Schema liefert drei Werte.
  select 'adresse_strasse' as feld_typ, f.daten -> (fld ->> 'id') ->> 'strasse' as wert
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  select 'adresse_plz', f.daten -> (fld ->> 'id') ->> 'plz'
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  select 'adresse_stadt', f.daten -> (fld ->> 'id') ->> 'stadt'
    from public.ausgefuellte_formulare f
    join public.formular_templates t on t.id = f.template_id
    cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
    cross join lateral jsonb_array_elements(coalesce(sec -> 'fields', '[]'::jsonb)) fld
   where f.status = 'submitted' and fld ->> 'type' = 'address'
  union all
  -- 2) Tour-Adressfelder (Migration 086/087).
  select 'adresse_strasse', t.strasse_start from public.touren t
  union all select 'adresse_strasse', t.strasse_ziel from public.touren t
  union all select 'adresse_strasse', t.strasse_rueckfuehrung from public.touren t
  union all select 'adresse_plz', t.plz_start from public.touren t
  union all select 'adresse_plz', t.plz_ziel from public.touren t
  union all select 'adresse_plz', t.plz_rueckfuehrung from public.touren t
  union all select 'adresse_stadt', t.start_stadt from public.touren t
  union all select 'adresse_stadt', t.ziel_stadt from public.touren t
  union all select 'adresse_stadt', t.rueckfuehrung_stadt from public.touren t
  union all
  -- 3) Fahrzeugmodell und Kundenname aus den Touren.
  select 'fahrzeugmodell', t.fahrzeugmodell from public.touren t
  union all select 'fahrzeugmodell', t.fahrzeugmodell_rueck from public.touren t
  union all select 'firma', t.kundenname from public.touren t
),
sauber as (
  select feld_typ,
         btrim(regexp_replace(wert, '\s+', ' ', 'g')) as wert
    from roh
   where wert is not null
),
gefiltert as (
  select feld_typ, wert
    from sauber
   where char_length(wert) between 3 and 200
),
gruppiert as (
  select feld_typ, lower(wert) as schluessel,
         min(wert) as schreibweise, count(*) as anzahl
    from gefiltert
   group by feld_typ, lower(wert)
)
insert into public.feld_vorschlaege (feld_typ, wert, anzahl, letzte_nutzung, ist_manuell)
select g.feld_typ, g.schreibweise, g.anzahl, now(), false
  from gruppiert g
 where not exists (
   select 1 from public.feld_vorschlaege fv
    where fv.feld_typ = g.feld_typ and lower(fv.wert) = g.schluessel
 );

insert into public.vorschlaege_backfill_log (eintraege)
select count(*) from public.feld_vorschlaege;

select feld_typ, count(*) as eintraege, sum(anzahl) as summe
  from public.feld_vorschlaege
 group by feld_typ order by feld_typ;

commit;
