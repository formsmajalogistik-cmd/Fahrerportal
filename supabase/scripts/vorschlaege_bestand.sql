-- Vorschlags-Pool: Bestandsaufnahme — NUR LESEN, ändert nichts.
--
-- Anlass: „Im Pool stehen nur PLZ und Orte, aber keine Straßen."
-- Die Ableitung im Frontend erkennt Straßenfelder nachweislich korrekt
-- (Feldtyp `adresse_strasse`), es muss also an den Daten liegen. Dieses
-- Skript zeigt, woran genau.

-- ------------------------------------------------------------
-- 1. Was liegt im Pool?
-- ------------------------------------------------------------
select
  feld_typ,
  count(*)                                   as eintraege,
  sum(anzahl)                                as nutzungen,
  count(*) filter (where ist_manuell)        as davon_manuell,
  min(letzte_nutzung)::date                  as aeltester,
  max(letzte_nutzung)::date                  as neuester
from public.feld_vorschlaege
group by feld_typ
order by feld_typ;

-- ------------------------------------------------------------
-- 2. Stichprobe je Topf (die fünf häufigsten Werte)
-- ------------------------------------------------------------
select feld_typ, wert, anzahl
from (
  select feld_typ, wert, anzahl,
         row_number() over (partition by feld_typ order by anzahl desc, wert) as rang
  from public.feld_vorschlaege
) x
where rang <= 5
order by feld_typ, rang;

-- ------------------------------------------------------------
-- 3. Wie viel WÄRE aus den Touren zu holen?
--
--    Wenn hier viele Städte, aber kaum Straßen stehen, liegt die
--    Ursache in den Tour-Daten: die Stadt-Spalten sind NOT NULL und
--    damit immer gefüllt, `strasse_*` und `plz_*` erst seit der
--    Umstellung auf strukturierte Adressen (086/087). Bestandstouren
--    tragen ihre Adresse weiter als Freitext in `adresse_*` — dort
--    holt sie niemand ab.
-- ------------------------------------------------------------
select 'adresse_strasse' as topf, count(distinct wert) as verschiedene_werte
from (
  select nullif(btrim(strasse_start), '') as wert from public.touren
  union all select nullif(btrim(strasse_ziel), '') from public.touren
  union all select nullif(btrim(strasse_rueckfuehrung), '') from public.touren
) s where wert is not null
union all
select 'adresse_plz', count(distinct wert) from (
  select nullif(btrim(plz_start), '') as wert from public.touren
  union all select nullif(btrim(plz_ziel), '') from public.touren
  union all select nullif(btrim(plz_rueckfuehrung), '') from public.touren
) s where wert is not null
union all
select 'adresse_stadt', count(distinct wert) from (
  select nullif(btrim(start_stadt), '') as wert from public.touren
  union all select nullif(btrim(ziel_stadt), '') from public.touren
  union all select nullif(btrim(rueckfuehrung_stadt), '') from public.touren
) s where wert is not null
union all
-- Touren, deren Adresse noch als Freitext dasteht: diese Werte kommen
-- weder in den Pool noch in die strukturierten Felder.
select 'nur_freitext_adresse', count(*)::bigint
from public.touren
where (coalesce(btrim(strasse_start), '') = '' and coalesce(btrim(adresse_start), '') <> '')
   or (coalesce(btrim(strasse_ziel),  '') = '' and coalesce(btrim(adresse_ziel),  '') <> '')
order by 1;

-- ------------------------------------------------------------
-- 4. Welche Formularfelder liefern überhaupt Adressen?
--
--    `address`-Felder füllen alle drei Töpfe auf einmal. Gibt es keine
--    (oder nur Freitext-Textfelder), kommt aus den Formularen nichts.
-- ------------------------------------------------------------
select
  t.name                                       as template,
  f->>'type'                                   as feldtyp,
  f->>'id'                                     as feld_id,
  coalesce(nullif(f->>'label', ''), f->>'id')  as beschriftung
from public.formular_templates t
cross join lateral jsonb_array_elements(coalesce(t.schema->'sections', '[]'::jsonb)) s
cross join lateral jsonb_array_elements(coalesce(s->'fields',   '[]'::jsonb)) f
where f->>'type' = 'address'
   or lower(coalesce(f->>'id', '') || ' ' || coalesce(f->>'label', ''))
      ~ '(stra(ß|ss)e|anschrift|adresse|plz|postleitzahl|(^|[^a-z])ort([^a-z]|$)|stadt)'
order by t.name, feld_id;
