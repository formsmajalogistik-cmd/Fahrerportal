-- Zusatz-Arten prüfen — NUR LESEN. Nach Migration 113 im SQL-Editor ausführen.
--
-- Listet alle tatsächlich vorkommenden Kategorien aus tour_zusaetze mit
-- Anzahl, dem Vergleichsschlüssel (ohne Groß/Klein, Leer-/Sonderzeichen,
-- Umlaute) und der Gruppe: „Auslage" / „keine Auslage" / „Keine Auslagen".
-- „unbekannt → Auslage" heißt: nicht in zusatz_arten eingetragen, zählt
-- deshalb als Auslage. Bei Tippvarianten (z.B. „Reifenhandling 2x") ggf.
-- in zusatz_arten nachtragen:
--   insert into zusatz_arten (schluessel, bezeichnung, zaehlt_als_auslage)
--   values (zusatz_art_schluessel('Reifenhandling 2x'), 'Reifenhandling 2x', false);

select z.kategorie,
       count(*)                                    as anzahl,
       public.zusatz_art_schluessel(z.kategorie)   as schluessel,
       case
         when public.zusatz_ist_keine_auslagen(z.kategorie) then 'Keine Auslagen'
         when a.schluessel is null then 'unbekannt → Auslage'
         when a.zaehlt_als_auslage then 'Auslage'
         else 'keine Auslage (wird berechnet, klärt nichts)'
       end                                          as gruppe
  from public.tour_zusaetze z
  left join public.zusatz_arten a on a.schluessel = public.zusatz_art_schluessel(z.kategorie)
 group by z.kategorie, a.schluessel, a.zaehlt_als_auslage
 order by gruppe, anzahl desc;
