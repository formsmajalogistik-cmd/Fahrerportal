-- Storage-Ablagen prüfen — NUR LESEN, ändert nichts.
--
-- Beantwortet drei Fragen auf einen Blick:
--   1. Existiert jede Ablage, die die App benutzt?
--   2. Ist sie privat (public = false)?
--   3. Hat sie die zugehörigen Zugriffsregeln?
--
-- Anlass: Beim Hinterlegen der Unterschrift kam „Bucket nicht
-- gefunden" — die Ablage war schlicht nicht angelegt, weil die
-- Migration noch nicht eingespielt war. Dieses Skript zeigt sofort,
-- ob dasselbe noch woanders offen ist.

-- ------------------------------------------------------------
-- 1. Soll/Ist-Abgleich der Ablagen
-- ------------------------------------------------------------
with soll(id, zweck, migration) as (
  values
    ('pdf-templates',   'PDF-Vorlagen der Formulare',        '003_storage.sql'),
    ('formular-fotos',  'Alt-Ablage Formularfotos (heute OneDrive)', '003_storage.sql'),
    ('formular-pdfs',   'Alt-Ablage Formular-PDFs (heute OneDrive)', '003_storage.sql'),
    ('damage-diagrams', 'Hintergrundbilder der Schadendiagramme',    '007_damage_diagrams_bucket.sql'),
    ('fuehrerschein',   'Führerschein-Bilder',               '061_fuehrerschein.sql'),
    ('absender',        'Unterschrift + Firmenstempel',      '092_absender_signatur.sql')
)
select
  soll.id                                        as ablage,
  soll.zweck,
  case when b.id is null then 'FEHLT' else 'vorhanden' end as status,
  case
    when b.id is null            then 'Migration ' || soll.migration || ' einspielen'
    when b.public                then 'ACHTUNG: öffentlich — sollte privat sein'
    else 'privat (ok)'
  end                                            as hinweis,
  soll.migration
from soll
left join storage.buckets b on b.id = soll.id
order by (b.id is null) desc, soll.id;

-- ------------------------------------------------------------
-- 2. Zugriffsregeln je Ablage
--
--    Eine vorhandene Ablage ohne passende Policy ist genauso
--    unbrauchbar wie eine fehlende: jeder Zugriff scheitert dann an
--    der RLS statt an „Bucket not found".
-- ------------------------------------------------------------
select
  p.policyname   as regel,
  p.cmd          as operation,
  p.roles::text  as fuer_rollen
from pg_policies p
where p.schemaname = 'storage'
  and p.tablename  = 'objects'
order by p.policyname;

-- ------------------------------------------------------------
-- 3. Ablagen, die es gibt, die die App aber nicht (mehr) kennt
--
--    Rein informativ — nichts davon muss gelöscht werden.
-- ------------------------------------------------------------
select b.id as unbekannte_ablage, b.public as ist_oeffentlich
from storage.buckets b
where b.id not in (
  'pdf-templates', 'formular-fotos', 'formular-pdfs',
  'damage-diagrams', 'fuehrerschein', 'absender'
)
order by b.id;

-- ------------------------------------------------------------
-- 4. Belegung — zeigt, ob in einer Ablage überhaupt etwas liegt
-- ------------------------------------------------------------
select
  coalesce(o.bucket_id, '(leer)') as ablage,
  count(*)                        as dateien
from storage.objects o
group by o.bucket_id
order by 1;
