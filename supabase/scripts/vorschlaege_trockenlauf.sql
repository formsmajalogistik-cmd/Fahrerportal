-- ============================================================
-- Vorschlags-Pool nachträglich befüllen — TROCKENLAUF
-- ------------------------------------------------------------
-- Ändert NICHTS. Zeigt nur, wie viele Einträge je Topf aus den
-- bereits eingereichten Formularen und aus den Tour-Adressfeldern
-- entstehen würden.
--
-- Gefiltert wird wie im laufenden Betrieb: Werte unter 3 Zeichen
-- fallen weg, Mehrfach-Leerzeichen werden zusammengezogen,
-- Groß-/Kleinschreibung zählt als derselbe Wert.
--
-- Die Topf-Schlüssel entsprechen der Ableitung im Frontend
-- (lib/feldVorschlaege.ts): adresse_strasse / adresse_plz /
-- adresse_stadt.
-- ============================================================

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
select
  g.feld_typ,
  count(*)                                              as neue_eintraege,
  sum(g.anzahl)                                         as summe_anzahl,
  count(*) filter (where fv.id is not null)             as schon_vorhanden
  from gruppiert g
  left join public.feld_vorschlaege fv
    on fv.feld_typ = g.feld_typ and lower(fv.wert) = g.schluessel
 group by g.feld_typ
 order by g.feld_typ;

-- Stichprobe: 20 Beispielwerte, die neu entstehen würden.
with roh as (
  select 'adresse_strasse' as feld_typ, t.strasse_start as wert from public.touren t
  union all select 'adresse_stadt', t.start_stadt from public.touren t
  union all select 'fahrzeugmodell', t.fahrzeugmodell from public.touren t
)
select feld_typ, btrim(regexp_replace(wert, '\s+', ' ', 'g')) as wert, count(*) as anzahl
  from roh
 where wert is not null
   and char_length(btrim(regexp_replace(wert, '\s+', ' ', 'g'))) >= 3
 group by 1, 2
 order by anzahl desc, 1, 2
 limit 20;
