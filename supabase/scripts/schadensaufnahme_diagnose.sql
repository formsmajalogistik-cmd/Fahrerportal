-- Schadensaufnahme: Bestandsprüfung — NUR LESEN, ändert nichts.
--
-- Drei Abfragen, jede für sich im SQL-Editor ausführbar.
--
-- 1) Welche Vorlagen sind vom Foto-Problem betroffen?
--    Der Foto-Dialog nach dem Setzen eines Schadens sucht das Kamera-Feld
--    der Zusatzbilder auf der AKTUELL angezeigten Formularseite. Liegt das
--    Zusatzbilder-Feld auf einer anderen Seite als das Schadendiagramm,
--    passiert beim Tippen auf „Foto aufnehmen" nichts.
--    Außerdem nimmt der Dialog das ERSTE dynamic_photos-Feld des Schemas —
--    ist das die Beleg-Sektion, landen Schadenfotos bei den Belegen.

with felder as (
  select t.id as template_id, t.name as vorlage, s->>'id' as section_id,
         f->>'id' as feld_id, f->>'type' as typ, coalesce(f->>'label', f->>'id') as label,
         row_number() over (partition by t.id order by si, fi) as reihenfolge
  from public.formular_templates t,
       jsonb_array_elements(coalesce(t.schema->'sections', '[]')) with ordinality as sec(s, si),
       jsonb_array_elements(coalesce(s->'fields', '[]')) with ordinality as fld(f, fi)
  where t.archiviert = false
    and f->>'type' in ('damage_diagram', 'dynamic_photos')
),
seiten as (
  select t.id as template_id, p->>'title' as seite, sid
  from public.formular_templates t,
       jsonb_array_elements(coalesce(t.schema->'pages', '[]')) as pg(p),
       jsonb_array_elements_text(coalesce(p->'sectionIds', '[]')) as sid
),
mit_seite as (
  select f.*, coalesce(s.seite, '(eine Seite)') as seite
  from felder f left join seiten s on s.template_id = f.template_id and s.sid = f.section_id
),
erstes_foto as (
  select distinct on (template_id) template_id, label, seite
  from mit_seite where typ = 'dynamic_photos' order by template_id, reihenfolge
)
select d.vorlage,
       d.seite                                   as seite_diagramm,
       e.label                                   as foto_dialog_ziel,
       e.seite                                   as seite_foto_ziel,
       case
         when e.template_id is null then 'kein Zusatzbilder-Feld — Foto-Dialog erscheint nicht'
         when e.seite <> d.seite    then 'BETROFFEN: andere Seite — „Foto aufnehmen" tut nichts'
         else 'gleiche Seite — Dialog funktioniert'
       end                                       as foto_dialog,
       case when lower(e.label) ~ '(beleg|quittung|rechnung|tank)' then 'JA — Fotos landen bei Belegen'
            else 'nein' end                      as ziel_ist_beleg_feld
from mit_seite d
left join erstes_foto e on e.template_id = d.template_id
where d.typ = 'damage_diagram'
order by d.vorlage;


-- 2) Eingereichte Formulare: fehlen Schäden im PDF?
--    Pro Formular mit Schadendiagramm: Anzahl Punkte, ungültige Punkte
--    (x/y fehlt oder außerhalb 0–100 — das PDF lässt sie still weg),
--    Obergrenze 20 erreicht, und Punktpaare, die sich im PDF überdecken
--    (Abstand < 14 pt in der gemappten Diagramm-Box — dann ist nur einer
--    zu sehen). 14 pt war die feste Markergröße bis zur Stabilisierung
--    der Schadensaufnahme; neu erzeugte PDFs passen die Größe an die Box
--    an (9–14 pt). Für bereits verschickte PDFs gilt die Zahl so.

with diagramme as (
  select a.id as formular_id, a.created_at, t.name as vorlage, f->>'id' as feld_id,
         a.daten -> (f->>'id') as punkte, t.pdfs
  from public.ausgefuellte_formulare a
  join public.formular_templates t on t.id = a.template_id,
       jsonb_array_elements(coalesce(t.schema->'sections', '[]')) as sec(s),
       jsonb_array_elements(coalesce(s->'fields', '[]')) as fld(f)
  where a.status = 'submitted' and f->>'type' = 'damage_diagram'
    and jsonb_typeof(a.daten -> (f->>'id')) = 'array'
),
box as (
  -- Größe der Diagramm-Box in der PDF (erste Vorlage, die das Feld mappt).
  select distinct on (d.formular_id, d.feld_id) d.formular_id, d.feld_id,
         (m.value->>'width')::numeric as w, (m.value->>'height')::numeric as h
  from diagramme d,
       jsonb_array_elements(coalesce(d.pdfs, '[]')) as pdf(p),
       jsonb_each(coalesce(p->'field_mapping', '{}')) as m
  where split_part(m.key, '#', 1) = d.feld_id and m.value->>'type' = 'damage_diagram'
),
punkte as (
  select d.formular_id, d.feld_id, i,
         case when jsonb_typeof(pt->'x') = 'number' then (pt->>'x')::numeric end as x,
         case when jsonb_typeof(pt->'y') = 'number' then (pt->>'y')::numeric end as y
  from diagramme d, jsonb_array_elements(d.punkte) with ordinality as e(pt, i)
),
ueberdeckt as (
  select a.formular_id, a.feld_id, count(*) as paare
  from punkte a
  join punkte b on b.formular_id = a.formular_id and b.feld_id = a.feld_id and b.i > a.i
  join box x on x.formular_id = a.formular_id and x.feld_id = a.feld_id
  where a.x is not null and b.x is not null and a.y is not null and b.y is not null
    and sqrt(power((a.x - b.x) / 100 * x.w, 2) + power((a.y - b.y) / 100 * x.h, 2)) < 14
  group by a.formular_id, a.feld_id
)
select d.vorlage, d.formular_id, d.created_at::date as eingereicht,
       jsonb_array_length(d.punkte)                                        as punkte,
       (select count(*) from punkte p where p.formular_id = d.formular_id and p.feld_id = d.feld_id
          and (p.x is null or p.y is null or p.x not between 0 and 100 or p.y not between 0 and 100)) as ungueltig,
       jsonb_array_length(d.punkte) >= 20                                  as obergrenze,
       coalesce(u.paare, 0)                                                as ueberdeckte_paare,
       b.w || ' × ' || b.h || ' pt'                                         as pdf_box
from diagramme d
left join box b       on b.formular_id = d.formular_id and b.feld_id = d.feld_id
left join ueberdeckt u on u.formular_id = d.formular_id and u.feld_id = d.feld_id
where jsonb_array_length(d.punkte) > 0
order by (coalesce(u.paare, 0) > 0
          or exists (select 1 from punkte p where p.formular_id = d.formular_id and p.feld_id = d.feld_id
                       and (p.x is null or p.y is null))) desc,
         d.created_at desc
limit 200;


-- 3) Zusammenfassung zu 2) — eine Zeile.
with diagramme as (
  select a.id, a.daten -> (f->>'id') as punkte
  from public.ausgefuellte_formulare a
  join public.formular_templates t on t.id = a.template_id,
       jsonb_array_elements(coalesce(t.schema->'sections', '[]')) as sec(s),
       jsonb_array_elements(coalesce(s->'fields', '[]')) as fld(f)
  where a.status = 'submitted' and f->>'type' = 'damage_diagram'
    and jsonb_typeof(a.daten -> (f->>'id')) = 'array'
)
select count(*)                                                    as formulare_mit_diagramm,
       count(*) filter (where jsonb_array_length(punkte) > 0)      as davon_mit_schaeden,
       coalesce(sum(jsonb_array_length(punkte)), 0)                as schaeden_gesamt,
       count(*) filter (where exists (
         select 1 from jsonb_array_elements(punkte) pt
         where jsonb_typeof(pt->'x') <> 'number' or jsonb_typeof(pt->'y') <> 'number'
       ))                                                          as formulare_mit_ungueltigen_punkten,
       count(*) filter (where jsonb_array_length(punkte) >= 20)    as formulare_an_obergrenze
from diagramme;
