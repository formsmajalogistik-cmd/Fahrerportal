-- Unterschiedliche Schreibweisen im Pool: TROCKENLAUF — NUR LESEN.
--
-- Gruppiert über einen Vergleichsschlüssel (Kleinschreibung, ß → ss,
-- „str."/„str" → „strasse", Satzzeichen und Leerzeichen weg). Der
-- Schlüssel entscheidet NUR, was zusammengehört — die angezeigte
-- Schreibweise bleibt die des Bestands, es wird nichts umgeschrieben.
--
-- Behalten wird die HÄUFIGSTE Original-Schreibweise der Gruppe; ihre
-- `anzahl` ist danach die Summe der Gruppe.
--
-- Voraussetzung: Migration 096.

-- ------------------------------------------------------------
-- 1. Überblick
-- ------------------------------------------------------------
with gruppen as (
  select
    feld_typ,
    public.maja_vergleichsschluessel(wert) as schluessel,
    count(*) as varianten
  from public.feld_vorschlaege
  group by 1, 2
  having count(*) > 1
)
select
  (select count(*) from public.feld_vorschlaege)       as eintraege_gesamt,
  (select count(*) from gruppen)                       as gruppen,
  (select coalesce(sum(varianten - 1), 0) from gruppen) as zeilen_die_wegfallen;

-- ------------------------------------------------------------
-- 2. Bis zu 30 Beispiele
--
--    [Variante A, Variante B, …] → behaltener Wert (Summe anzahl)
-- ------------------------------------------------------------
with kandidaten as (
  select
    feld_typ,
    public.maja_vergleichsschluessel(wert) as schluessel,
    wert, anzahl, ist_manuell, id
  from public.feld_vorschlaege
),
gruppen as (
  select
    feld_typ, schluessel,
    count(*)                                  as varianten,
    sum(anzahl)                               as summe,
    string_agg(wert, ', ' order by anzahl desc, wert) as alle_varianten,
    -- Behalten wird der manuell gepflegte bzw. häufigste Eintrag —
    -- seine ORIGINAL-Schreibweise, nur getrimmt und mit großem
    -- Anfangsbuchstaben.
    (array_agg(wert order by ist_manuell desc, anzahl desc, id))[1] as behalten_roh
  from kandidaten
  group by feld_typ, schluessel
  having count(*) > 1
)
select
  feld_typ,
  alle_varianten                        as varianten,
  -- genau die Aufbereitung, die das Block-Skript anwendet
  (select upper(left(b, 1)) || substr(b, 2)
     from (select btrim(behalten_roh, ' ,;') as b) t) as behaltener_wert,
  summe                                 as summe_anzahl,
  varianten                             as anzahl_varianten
from gruppen
order by varianten desc, summe desc
limit 30;
