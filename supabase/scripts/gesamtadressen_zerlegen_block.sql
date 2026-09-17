-- Gesamtadressen zerlegen — EIN BLOCK pro Ausführung. ÄNDERT DATEN.
--
-- ERST gesamtadressen_trockenlauf.sql laufen lassen und freigeben.
--
-- Je erkannter Gesamtadresse passiert dreierlei:
--   1. Die Bestandteile landen in ihren Töpfen (Straße, PLZ, Ort).
--      Steht ein Teil schon dort, wird er hochgezählt statt doppelt
--      angelegt. Fehlt der Ort im Original, bleibt er leer — er wird
--      nicht aus der PLZ abgeleitet.
--   2. Die vollständige Adresse kommt als EIN Eintrag ins Adressbuch —
--      damit lässt sie sich künftig als Ganzes auswählen und füllt
--      Straße, PLZ und Ort gemeinsam. Auch hier: nicht doppelt anlegen.
--   3. Die ursprüngliche Zeile (die ganze Adresse im Straßen-Topf)
--      wird entfernt — genau sie war das Problem.
--
-- Nicht eindeutig zerlegbare Werte bleiben unangetastet.
--
-- Höchstens 200 Adressen pro Lauf. So oft ausführen, bis
-- „offen_danach" 0 meldet. Beliebig oft wiederholbar.

begin;

create temporary table maja_zerlegung on commit drop as
select
  f.id,
  f.feld_typ,
  f.wert                                          as original,
  f.anzahl,
  (public.maja_adresse_zerlegen(f.wert)).strasse  as strasse,
  (public.maja_adresse_zerlegen(f.wert)).plz      as plz,
  (public.maja_adresse_zerlegen(f.wert)).ort      as ort,
  regexp_replace(lower(f.feld_typ), '_strasse$', '') as basis
from public.feld_vorschlaege f
where (f.feld_typ = 'adresse_strasse' or f.feld_typ ~ '_strasse$')
  and public.maja_ist_gesamtadresse(f.wert)
  and public.maja_adresse_zerlegbar(f.wert)
limit 200;

-- „adresse_strasse" → Basis „adresse"; ein eigener Topf wie
-- „abholung_strasse" behält seine Basis „abholung".
update maja_zerlegung set basis = 'adresse' where basis = 'adresse_strasse';

-- ---- 1. Bestandteile in die Töpfe ----
insert into public.feld_vorschlaege (feld_typ, wert, anzahl)
select basis || '_strasse', strasse, anzahl from maja_zerlegung
union all
select basis || '_plz', plz, anzahl from maja_zerlegung
union all
-- Der Ort kann fehlen („Offakamp 10, 22529"). Dann gibt es nichts
-- einzutragen — er wird NICHT aus der PLZ abgeleitet.
select basis || '_stadt', ort, anzahl from maja_zerlegung where ort is not null
on conflict (feld_typ, wert) do update
  set anzahl         = public.feld_vorschlaege.anzahl + excluded.anzahl,
      letzte_nutzung = now();

-- ---- 2. Vollständige Adresse ins Adressbuch ----
--
-- Nur, wenn es sie dort nicht schon gibt (Vergleich über Straße-
-- Schlüssel + PLZ). `bezeichnung` bleibt leer — die Adresse spricht
-- für sich, und der Admin kann sie jederzeit benennen.
insert into public.adressbuch (strasse, plz, ort)
select distinct on (public.maja_vergleichsschluessel(z.strasse), z.plz)
       z.strasse, z.plz, z.ort
from maja_zerlegung z
where not exists (
  select 1 from public.adressbuch a
   where public.maja_vergleichsschluessel(a.strasse)
       = public.maja_vergleichsschluessel(z.strasse)
     and coalesce(a.plz, '') = coalesce(z.plz, '')
)
order by public.maja_vergleichsschluessel(z.strasse), z.plz, z.anzahl desc;

-- ---- 3. Ursprungszeile entfernen ----
delete from public.feld_vorschlaege f
 using maja_zerlegung z
 where f.id = z.id;

select
  (select count(*) from maja_zerlegung) as adressen_zerlegt;

commit;

-- Wie viele sind noch offen? 0 = fertig.
select
  count(*) filter (where public.maja_ist_gesamtadresse(wert)
                     and public.maja_adresse_zerlegbar(wert))     as offen_danach,
  count(*) filter (where public.maja_ist_gesamtadresse(wert)
                     and not public.maja_adresse_zerlegbar(wert)) as bleibt_unzerlegbar
from public.feld_vorschlaege
where feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$';
