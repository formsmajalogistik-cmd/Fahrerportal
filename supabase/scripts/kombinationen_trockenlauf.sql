-- Adress-Kombinationen aus dem Bestand: TROCKENLAUF — NUR LESEN.
--
-- Nach dem Zerlegen steht im Pool nur noch die reine Straße. Welche PLZ
-- und welcher Ort dazugehören, lässt sich aber aus dem Bestand
-- zurückgewinnen: aus den Touren (Start / Ziel / Rückführung) und aus
-- den eingereichten Formularen — überall dort, wo Straße, PLZ und Ort
-- GEMEINSAM gepflegt sind.
--
-- Es wird nichts geschrieben. Voraussetzung: Migration 097.

with roh as (
  -- ---- Touren: drei Stationen ----
  select strasse_start          as strasse, plz_start          as plz, start_stadt         as ort
    from public.touren
  union all
  select strasse_ziel,          plz_ziel,          ziel_stadt          from public.touren
  union all
  select strasse_rueckfuehrung, plz_rueckfuehrung, rueckfuehrung_stadt from public.touren
  union all
  -- ---- Formulare: jedes Feld vom Typ "address" ----
  select
    f.daten -> (fld ->> 'id') ->> 'strasse',
    f.daten -> (fld ->> 'id') ->> 'plz',
    f.daten -> (fld ->> 'id') ->> 'stadt'
  from public.ausgefuellte_formulare f
  join public.formular_templates t on t.id = f.template_id
  cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(coalesce(sec  -> 'fields',   '[]'::jsonb)) fld
  where f.status = 'submitted' and fld ->> 'type' = 'address'
),
sauber as (
  select
    public.maja_vorschlag_schreibweise('adresse_strasse',
      btrim(regexp_replace(strasse, '\s+', ' ', 'g'), ' ,;')) as strasse,
    btrim(plz, ' ,;')                                          as plz,
    public.maja_vorschlag_schreibweise('adresse_stadt',
      btrim(regexp_replace(ort, '\s+', ' ', 'g'), ' ,;'))      as ort
  from roh
  where coalesce(btrim(strasse), '') <> ''
    and coalesce(btrim(plz), '')     <> ''
    and coalesce(btrim(ort), '')     <> ''
),
gefiltert as (
  -- Eine Straße mit PLZ darin wäre eine unzerlegte Gesamtadresse und
  -- gehört nicht als „Straße" in eine Kombination.
  select * from sauber where not public.maja_ist_gesamtadresse(strasse)
),
gruppiert as (
  select
    -- Gruppiert wird über den Vergleichsschlüssel, damit
    -- „Bahnhofstr. 5" und „Bahnhofstraße 5" eine Kombination ergeben.
    public.maja_vergleichsschluessel(strasse) as s_key,
    plz,
    public.maja_vergleichsschluessel(ort)     as o_key,
    count(*)::int                             as vorkommen,
    (array_agg(strasse order by length(strasse) desc))[1] as strasse,
    (array_agg(ort     order by length(ort)     desc))[1] as ort
  from gefiltert
  group by 1, 2, 3
)
-- ---- 1. Überblick ----
select
  (select count(*) from gefiltert)   as gefundene_datensaetze,
  (select count(*) from gruppiert)   as kombinationen,
  (select count(distinct s_key) from gruppiert) as verschiedene_strassen,
  (select count(*) from (
     select s_key from gruppiert group by s_key having count(*) > 1
   ) m)                              as strassen_mit_mehreren_orten,
  (select count(*) from public.adress_kombinationen) as bereits_vorhanden;

-- ---- 2. Bis zu 20 Beispiele ----
--
-- `weitere_orte` zeigt, ob dieselbe Straße noch in anderen Orten
-- vorkommt — dort bietet die Auswahl später mehrere Varianten an.
with roh as (
  select strasse_start          as strasse, plz_start          as plz, start_stadt         as ort
    from public.touren
  union all
  select strasse_ziel,          plz_ziel,          ziel_stadt          from public.touren
  union all
  select strasse_rueckfuehrung, plz_rueckfuehrung, rueckfuehrung_stadt from public.touren
  union all
  select
    f.daten -> (fld ->> 'id') ->> 'strasse',
    f.daten -> (fld ->> 'id') ->> 'plz',
    f.daten -> (fld ->> 'id') ->> 'stadt'
  from public.ausgefuellte_formulare f
  join public.formular_templates t on t.id = f.template_id
  cross join lateral jsonb_array_elements(coalesce(t.schema -> 'sections', '[]'::jsonb)) sec
  cross join lateral jsonb_array_elements(coalesce(sec  -> 'fields',   '[]'::jsonb)) fld
  where f.status = 'submitted' and fld ->> 'type' = 'address'
),
sauber as (
  select
    public.maja_vorschlag_schreibweise('adresse_strasse',
      btrim(regexp_replace(strasse, '\s+', ' ', 'g'), ' ,;')) as strasse,
    btrim(plz, ' ,;')                                          as plz,
    public.maja_vorschlag_schreibweise('adresse_stadt',
      btrim(regexp_replace(ort, '\s+', ' ', 'g'), ' ,;'))      as ort
  from roh
  where coalesce(btrim(strasse), '') <> ''
    and coalesce(btrim(plz), '')     <> ''
    and coalesce(btrim(ort), '')     <> ''
),
gefiltert as (
  select * from sauber where not public.maja_ist_gesamtadresse(strasse)
),
gruppiert as (
  select
    public.maja_vergleichsschluessel(strasse) as s_key,
    plz,
    public.maja_vergleichsschluessel(ort)     as o_key,
    count(*)::int                             as vorkommen,
    (array_agg(strasse order by length(strasse) desc))[1] as strasse,
    (array_agg(ort     order by length(ort)     desc))[1] as ort
  from gefiltert
  group by 1, 2, 3
)
select
  strasse,
  plz,
  ort,
  vorkommen,
  count(*) over (partition by s_key) - 1 as weitere_orte
from gruppiert
order by vorkommen desc, strasse
limit 20;
