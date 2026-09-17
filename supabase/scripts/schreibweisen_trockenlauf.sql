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
-- 2. Bis zu 30 Beispiele — die GRÖSSTEN Gruppen zuerst
--
--    [Variante A (n), Variante B (n), …] → behaltener Wert (Summe)
--
--    Die Varianten stehen mit ihrer eigenen `anzahl` da. Das ist
--    wichtig: behalten wird die häufigste Schreibweise, und bei
--    Gleichstand entscheidet die Reihenfolge — dann lohnt ein Blick,
--    ob die behaltene Variante wirklich die schönere ist. Wenn nicht:
--    in der Pool-Pflege bearbeiten, dafür ist sie da.
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
    count(*)::int as anzahl_varianten,
    sum(anzahl)   as summe,
    string_agg(wert || ' (' || anzahl || ')', ', ' order by anzahl desc, wert) as varianten,
    -- Behalten wird der manuell gepflegte bzw. häufigste Eintrag.
    -- Bei GLEICHSTAND entschied bisher die id, also der Zufall — und
    -- das traf im Bestand oft die unsaubere Variante („Münchenerstr. 41
    -- , 85123 Karlskron"). Jetzt gewinnt die gepflegtere Schreibweise:
    -- kein Leerzeichen vor einem Satzzeichen, ein Leerzeichen nach dem
    -- Komma, keine Doppelleerzeichen; danach die ausgeschriebene Form
    -- („Daimlerstraße 1" statt „Daimlerstr. 1"); bei gleicher Länge die
    -- mit Bindestrich („Bernhard-Nocht-Straße" statt „Bernhard Nocht
    -- Straße"). Umgeschrieben wird weiterhin NICHTS — es wird nur unter
    -- den vorhandenen Varianten gewählt.
    (array_agg(wert order by
       ist_manuell desc,
       anzahl desc,
       (wert ~ ' [,;]' or wert ~ ',[^ ]' or wert ~ '  '),
       length(wert) desc,
       length(wert) - length(replace(wert, ' ', '')),
       id))[1] as behalten_roh,
    -- Gibt es an der Spitze einen Gleichstand? Dann ist die Auswahl
    -- willkürlich und einen Blick wert.
    (count(*) filter (where anzahl = (select max(k2.anzahl) from kandidaten k2
                                       where k2.feld_typ = kandidaten.feld_typ
                                         and k2.schluessel = kandidaten.schluessel)) > 1)
      as gleichstand
  from kandidaten
  group by feld_typ, schluessel
  having count(*) > 1
)
select
  feld_typ,
  varianten,
  (select upper(left(b, 1)) || substr(b, 2)
     from (select btrim(behalten_roh, ' ,;') as b) t) as behaltener_wert,
  summe            as summe_anzahl,
  anzahl_varianten,
  gleichstand      as auswahl_willkuerlich
from gruppen
-- WICHTIG: nach der ZAHL sortieren, nicht nach dem Text. Beim ersten
-- Anlauf hieß die Textspalte ebenfalls „varianten"; PostgreSQL löst
-- ORDER BY zuerst gegen Ausgabespalten auf und sortierte deshalb
-- alphabetisch — die Stichprobe zeigte das Ende des Alphabets statt
-- der größten Gruppen.
order by anzahl_varianten desc, summe desc
limit 30;
