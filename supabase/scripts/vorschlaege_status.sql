-- Adress-Pool: Zustand prüfen — NUR LESEN, ändert nichts.
--
-- Vor dem Bereinigen ausführen und das Ergebnis melden. Läuft in
-- Sekundenbruchteilen, auch bei einem großen Pool.
--
-- Voraussetzung: Migration 093 (legt die Normalisierungs-Funktionen an).

with normalisiert as (
  select
    id, feld_typ, wert,
    public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
  from public.feld_vorschlaege
),
gruppen as (
  select feld_typ, lower(neu) as schluessel, count(*) as n
  from normalisiert
  group by 1, 2
  having count(*) > 1
)
select
  (select count(*) from normalisiert)                        as eintraege_gesamt,
  (select count(*) from normalisiert where wert is distinct from neu)
                                                             as noch_nicht_normalisiert,
  (select count(*) from gruppen)                             as duplikat_gruppen,
  (select coalesce(sum(n - 1), 0) from gruppen)              as zeilen_die_wegfallen,
  (select count(*) from public.adressbuch a
    where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
       or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
       or a.ort         is distinct from public.maja_gross_anfang(a.ort))
                                                             as adressbuch_offen;

-- Beispiele: die zwanzig größten Dubletten-Gruppen. Zeigt, was beim
-- Zusammenführen passieren wird.
with normalisiert as (
  select feld_typ, wert, anzahl,
         public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
  from public.feld_vorschlaege
)
select
  feld_typ,
  lower(neu)                        as zusammengefasst_zu,
  count(*)                          as schreibweisen,
  sum(anzahl)                       as nutzungen_summiert,
  string_agg(wert, ' | ' order by wert) as bisherige_werte
from normalisiert
group by feld_typ, lower(neu)
having count(*) > 1
order by count(*) desc, sum(anzahl) desc
limit 20;
