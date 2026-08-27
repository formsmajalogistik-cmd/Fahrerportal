-- Falsch abgelegte Belege finden — NUR LESEN, verschiebt nichts.
--
-- Hintergrund: Belege und Zusatzbilder haben denselben Feldtyp
-- (`dynamic_photos`). Die Funktion „Belege ergänzen" nahm bisher immer
-- das ERSTE solche Feld des Templates — stand die Zusatzbilder-Sektion
-- im Schema vorn, landeten ergänzte Belege dort und tauchten deshalb
-- nie in der Belege-PDF auf.
--
-- Dieses Skript zeigt, wie viele nachträglich ergänzte Belege heute in
-- einer Zusatzbilder-Sektion liegen. Verschoben wird NICHTS — das
-- passiert erst nach ausdrücklicher Freigabe.
--
-- Die Einordnung benutzt dieselben Stichwörter wie das Frontend
-- (belegFeldArt in src/lib/belegeErgaenzen.ts): „zusatz" gewinnt vor
-- „beleg", damit eine Sektion „Zusatzbelege" als Zusatz zählt.

with felder as (
  select
    t.id                            as template_id,
    t.name                          as template,
    f->>'id'                        as feld_id,
    coalesce(nullif(f->>'label', ''), f->>'id') as feld_label
  from public.formular_templates t
  cross join lateral jsonb_array_elements(coalesce(t.schema->'sections', '[]'::jsonb)) s
  cross join lateral jsonb_array_elements(coalesce(s->'fields',   '[]'::jsonb)) f
  where f->>'type' = 'dynamic_photos'
),
klassifiziert as (
  select
    felder.*,
    case
      when lower(feld_id || ' ' || feld_label) ~ '(zusatz|weitere|sonstige|extra)'
        then 'zusatz'
      when lower(feld_id || ' ' || feld_label) ~ '(beleg|quittung|kassenbon|bon|rechnung|nachweis)'
        then 'beleg'
      else 'unbekannt'
    end as art
  from felder
),
eintraege as (
  select
    k.template, k.feld_label, k.art,
    af.id as formular_id,
    e     as eintrag
  from klassifiziert k
  join public.ausgefuellte_formulare af on af.template_id = k.template_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(af.daten -> k.feld_id) = 'array'
         then af.daten -> k.feld_id
         else '[]'::jsonb end
  ) e
)

-- 1) Bild-Sektionen je Template mit ihrer Einordnung. Zeigt sofort, ob
--    ein Template überhaupt eine erkennbare Beleg-Sektion hat und in
--    welcher Reihenfolge die Sektionen stehen.
select 'Sektionen' as block, template, feld_label, art, null::bigint as anzahl
from klassifiziert
union all

-- 2) Der eigentliche Befund: nachträglich ergänzte Belege, die in einer
--    Zusatzbilder-Sektion liegen.
select 'Ergänzt in Zusatzbildern', template, feld_label, art, count(*)
from eintraege
where art = 'zusatz'
  and coalesce((eintrag->>'nachtraeglich_ergaenzt')::boolean, false)
group by template, feld_label, art
union all

-- 3) Zum Vergleich: ergänzte Belege, die korrekt in einer Beleg-Sektion
--    liegen.
select 'Ergänzt in Belegen', template, feld_label, art, count(*)
from eintraege
where art = 'beleg'
  and coalesce((eintrag->>'nachtraeglich_ergaenzt')::boolean, false)
group by template, feld_label, art
union all

-- 4) Templates ohne erkennbare Beleg-Sektion — dort ist eine Ergänzung
--    ohne Rückfrage gar nicht sinnvoll möglich.
select 'Ohne Beleg-Sektion', template, '—', '—', null::bigint
from (
  select distinct template from klassifiziert
  where template not in (select template from klassifiziert where art = 'beleg')
) x

order by 1, 2, 3;
