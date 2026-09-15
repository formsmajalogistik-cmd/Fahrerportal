-- Gesamtadressen im Straßen-Pool: TROCKENLAUF — NUR LESEN.
--
-- Zeigt, welche Straßen-Einträge in Wahrheit ganze Adressen sind und
-- wie sie zerlegt würden. Es wird NICHTS geändert und NICHTS gelöscht.
--
-- Erkennung: eine fünfstellige Zahl im Wert (PLZ). Straßennamen und
-- Hausnummern enthalten praktisch nie fünfstellige Zahlen.
--
-- Voraussetzung: Migration 096.

-- ------------------------------------------------------------
-- 1. Überblick
-- ------------------------------------------------------------
select
  count(*)                                                as strassen_eintraege,
  count(*) filter (where public.maja_ist_gesamtadresse(wert))
                                                          as davon_gesamtadressen,
  count(*) filter (where public.maja_ist_gesamtadresse(wert)
                     and public.maja_adresse_zerlegbar(wert))
                                                          as eindeutig_zerlegbar,
  count(*) filter (where public.maja_ist_gesamtadresse(wert)
                     and not public.maja_adresse_zerlegbar(wert))
                                                          as nicht_zerlegbar
from public.feld_vorschlaege
where feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$';

-- ------------------------------------------------------------
-- 2. Bis zu 30 Beispiele: Original → Straße | PLZ | Ort
-- ------------------------------------------------------------
select
  wert                                          as original,
  (public.maja_adresse_zerlegen(wert)).strasse  as strasse,
  (public.maja_adresse_zerlegen(wert)).plz      as plz,
  (public.maja_adresse_zerlegen(wert)).ort      as ort,
  anzahl,
  -- Steht der reine Straßenteil schon eigenständig im Pool? Dann wird
  -- er beim Anwenden nicht doppelt angelegt, sondern hochgezählt.
  exists (
    select 1 from public.feld_vorschlaege x
     where x.feld_typ = f.feld_typ
       and public.maja_vergleichsschluessel(x.wert)
         = public.maja_vergleichsschluessel((public.maja_adresse_zerlegen(f.wert)).strasse)
  )                                             as strasse_schon_vorhanden,
  -- Gibt es die Adresse schon im Adressbuch?
  exists (
    select 1 from public.adressbuch a
     where public.maja_vergleichsschluessel(a.strasse)
         = public.maja_vergleichsschluessel((public.maja_adresse_zerlegen(f.wert)).strasse)
       and coalesce(a.plz, '') = coalesce((public.maja_adresse_zerlegen(f.wert)).plz, '')
  )                                             as adressbuch_schon_vorhanden
from public.feld_vorschlaege f
where (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
  and public.maja_ist_gesamtadresse(wert)
  and public.maja_adresse_zerlegbar(wert)
order by anzahl desc, wert
limit 30;

-- ------------------------------------------------------------
-- 3. Nicht eindeutig zerlegbar — bleiben unverändert
--
--    Typisch: nur „28816 Stuhr" ohne Straße, oder eine PLZ ohne
--    Ortsangabe dahinter. Hier wird bewusst nicht geraten.
-- ------------------------------------------------------------
select
  wert                                          as original,
  (public.maja_adresse_zerlegen(wert)).strasse  as strasse_erkannt,
  (public.maja_adresse_zerlegen(wert)).plz      as plz_erkannt,
  (public.maja_adresse_zerlegen(wert)).ort      as ort_erkannt,
  anzahl
from public.feld_vorschlaege
where (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
  and public.maja_ist_gesamtadresse(wert)
  and not public.maja_adresse_zerlegbar(wert)
order by anzahl desc, wert;
