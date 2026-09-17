-- Adress-Kombinationen aus dem Bestand zurückgewinnen — EIN BLOCK pro
-- Ausführung. ÄNDERT DATEN.
--
-- ERST kombinationen_trockenlauf.sql laufen lassen und freigeben.
--
-- Höchstens 500 Kombinationen pro Lauf. So oft ausführen, bis
-- „offen_danach" 0 meldet.
--
-- Idempotent: es werden ausschließlich FEHLENDE Kombinationen angelegt.
-- Bereits vorhandene bleiben unangetastet — insbesondere wird ihre
-- `anzahl` NICHT erneut hochgezählt, sonst blähte jeder weitere Lauf
-- die Häufigkeiten auf.
--
-- Die Dubletten-Erkennung läuft über den Vergleichsschlüssel: existiert
-- „Bahnhofstraße 5 / 28195 / Bremen", wird „Bahnhofstr. 5 / 28195 /
-- Bremen" nicht ein zweites Mal angelegt.

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
  -- Eine Straße mit PLZ darin wäre eine unzerlegte Gesamtadresse.
  select * from sauber where not public.maja_ist_gesamtadresse(strasse)
),
gruppiert as (
  select
    public.maja_vergleichsschluessel(strasse) as s_key,
    plz,
    public.maja_vergleichsschluessel(ort)     as o_key,
    count(*)::int                             as vorkommen,
    -- Angezeigt wird die ausgeschriebene Variante.
    (array_agg(strasse order by length(strasse) desc))[1] as strasse,
    (array_agg(ort     order by length(ort)     desc))[1] as ort
  from gefiltert
  group by 1, 2, 3
),
fehlend as (
  select g.strasse, g.plz, g.ort, g.vorkommen
  from gruppiert g
  where not exists (
    select 1 from public.adress_kombinationen a
     where public.maja_vergleichsschluessel(a.strasse) = g.s_key
       and coalesce(a.plz, '') = g.plz
       and public.maja_vergleichsschluessel(coalesce(a.ort, '')) = g.o_key
  )
  order by g.vorkommen desc, g.strasse
  limit 500
)
insert into public.adress_kombinationen (strasse, plz, ort, anzahl)
select strasse, plz, ort, vorkommen from fehlend
-- Falls zwei Schreibweisen im selben Block exakt dieselbe Zeile
-- ergäben, gewinnt die erste — die Unique-Bedingung fängt es ab.
on conflict (strasse, plz, ort) do nothing;

-- Wie viele Kombinationen fehlen noch? 0 = fertig.
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
gruppiert as (
  select
    public.maja_vergleichsschluessel(strasse) as s_key,
    plz,
    public.maja_vergleichsschluessel(ort)     as o_key
  from sauber
  where not public.maja_ist_gesamtadresse(strasse)
  group by 1, 2, 3
)
select
  count(*) filter (where not exists (
    select 1 from public.adress_kombinationen a
     where public.maja_vergleichsschluessel(a.strasse) = g.s_key
       and coalesce(a.plz, '') = g.plz
       and public.maja_vergleichsschluessel(coalesce(a.ort, '')) = g.o_key
  ))                                                  as offen_danach,
  (select count(*) from public.adress_kombinationen)  as kombinationen_gesamt
from gruppiert g;
