-- Vorschlags-Pool aufräumen: LÖSCHT — ein Block pro Ausführung.
--
-- ERST pool_aufraeumen_trockenlauf.sql laufen lassen und das Ergebnis
-- freigeben. Dieses Skript entfernt:
--   A) alle Einträge in Töpfen, die keine Adressteile sind
--   B) Straßen-Einträge, die eine ganze Adresse enthalten (PLZ im Wert)
--
-- Höchstens 500 Zeilen pro Lauf, damit die Verbindung nicht in einen
-- Timeout läuft (Erfahrung aus der Normalisierung). So oft ausführen,
-- bis „offen_danach" 0 meldet.
--
-- Bewusst LÖSCHEN statt kürzen: aus „Musterweg 3, 28195 Bremen" ließe
-- sich zwar „Musterweg 3" gewinnen, aber nicht zuverlässig — manche
-- Werte tragen vor der PLZ gar keine brauchbare Straße. Der
-- Trockenlauf zeigt in `vorschlag_kuerzen`, was ein Kürzen ergäbe;
-- wer das will, spricht es vorher ab.
--
-- Beliebig oft wiederholbar.

with kandidaten as (
  select id
  from public.feld_vorschlaege
  where not public.maja_ist_adress_topf(feld_typ)
     or (
       (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
       and public.maja_ist_gesamtadresse(wert)
     )
  limit 500
),
entfernt as (
  delete from public.feld_vorschlaege fv
   using kandidaten k
   where fv.id = k.id
  returning fv.id
)
select (select count(*) from entfernt) as zeilen_entfernt;

-- Wie viele sind noch offen? 0 = fertig.
select
  count(*) filter (where not public.maja_ist_adress_topf(feld_typ)) as fremde_toepfe_offen,
  count(*) filter (
    where public.maja_ist_adress_topf(feld_typ)
      and (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
      and public.maja_ist_gesamtadresse(wert)
  )                                                                 as gesamtadressen_offen,
  count(*) filter (
    where not public.maja_ist_adress_topf(feld_typ)
       or (
         (feld_typ = 'adresse_strasse' or feld_typ ~ '_strasse$')
         and public.maja_ist_gesamtadresse(wert)
       )
  )                                                                 as offen_danach
from public.feld_vorschlaege;
