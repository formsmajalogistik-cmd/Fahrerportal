-- Vorschlags-Pool aufräumen: TROCKENLAUF — NUR LESEN, löscht nichts.
--
-- Zwei Fragen auf einmal:
--   A) Wie viele Einträge stehen in Töpfen, die es nicht mehr geben
--      soll (Kennzeichen, Modelle, E-Mails, Namen …)?
--   B) Wie viele Straßen-Einträge sind in Wahrheit ganze Adressen
--      („Heiligenroder Strasse 38e, 28816 Stuhr")? Die landen beim
--      Auswählen komplett im Straßenfeld.
--
-- Erkennungsregel für (B): eine fünfstellige Zahl im Wert. Eine Straße
-- mit Hausnummer enthält keine.
--
-- Zuerst dieses Skript, Ergebnis besprechen, dann erst
-- pool_aufraeumen_block.sql.
--
-- Voraussetzung: Migration 095 (legt maja_ist_adress_topf und
-- maja_ist_gesamtadresse an).

-- ------------------------------------------------------------
-- 1. Überblick: was liegt insgesamt an?
-- ------------------------------------------------------------
select
  count(*)                                                        as eintraege_gesamt,
  count(*) filter (where not public.maja_ist_adress_topf(feld_typ)) as fremde_toepfe,
  count(*) filter (
    where public.maja_ist_adress_topf(feld_typ)
      and (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
      and public.maja_ist_gesamtadresse(wert)
  )                                                               as gesamtadressen,
  count(*) filter (
    where public.maja_ist_adress_topf(feld_typ)
      and not (
        (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
        and public.maja_ist_gesamtadresse(wert)
      )
  )                                                               as bleibt_uebrig
from public.feld_vorschlaege;

-- ------------------------------------------------------------
-- 2. (A) Fremd-Einträge je Topf — was würde wegfallen
-- ------------------------------------------------------------
select
  feld_typ,
  count(*)   as eintraege,
  sum(anzahl) as nutzungen,
  -- fünf Beispiele, damit erkennbar ist, worum es geht
  (array_agg(wert order by anzahl desc, wert))[1:5] as beispiele
from public.feld_vorschlaege
where not public.maja_ist_adress_topf(feld_typ)
group by feld_typ
order by count(*) desc;

-- ------------------------------------------------------------
-- 3. (B) Gesamtadressen im Straßen-Topf — bis zu 30 Beispiele
--
--    `vorschlag_kuerzen` zeigt, was beim KÜRZEN statt Löschen
--    herauskäme (alles vor der PLZ). Bewusst nur als Anzeige — das
--    Block-Skript löscht, es kürzt nicht. Ist die Spalte leer, war im
--    Wert vor der PLZ nichts Brauchbares; solche Einträge gehören
--    ohnehin gelöscht.
-- ------------------------------------------------------------
select
  feld_typ,
  wert,
  anzahl,
  letzte_nutzung::date as zuletzt,
  btrim(coalesce(
    substring(wert from '^(.*?)[[:space:]]*[,;]?[[:space:]]*[0-9]{5}([^0-9]|$)'), ''
  ), ' ,;-') as vorschlag_kuerzen
from public.feld_vorschlaege
where (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
  and public.maja_ist_gesamtadresse(wert)
order by anzahl desc, wert
limit 30;

-- ------------------------------------------------------------
-- 4. Gegenprobe: Straßen, die bleiben (bis zu 15 Beispiele)
--
--    Zeigt, dass reine Straßeneinträge NICHT von der Regel erfasst
--    werden.
-- ------------------------------------------------------------
select feld_typ, wert, anzahl
from public.feld_vorschlaege
where (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
  and not public.maja_ist_gesamtadresse(wert)
order by anzahl desc, wert
limit 15;
