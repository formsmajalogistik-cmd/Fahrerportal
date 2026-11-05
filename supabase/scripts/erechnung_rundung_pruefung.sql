-- E-Rechnung: Rundungs-Prüfung — NUR LESEN, ändert nichts.
--
-- Im Supabase-SQL-Editor ausführen (jede Abfrage liefert eine eigene
-- Ergebnistabelle). Hintergrund: Die E-Rechnung (EN 16931) verlangt
-- Beträge mit höchstens 2 Nachkommastellen, einen nicht-negativen
-- Einzelpreis (Regel BR-27) und Summen, die exakt aus den Positionen
-- folgen (BR-CO-10/-13/-14/-15). Gemeldet wird nur — korrigiert wird
-- nichts.

-- 0) Spaltentypen im echten Schema. Im Repo sind Menge, Einzelpreis und
--    Gesamtpreis der Rechnungspositionen decimal(10,2): mehr als 2
--    Nachkommastellen sind dann technisch ausgeschlossen. Steht hier
--    etwas anderes, wurde das Schema außerhalb der Migrationen geändert.
select table_name as tabelle, column_name as spalte, data_type as typ,
       numeric_precision as stellen, numeric_scale as nachkommastellen
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('rechnungspositionen', 'gutschriftspositionen', 'rechnungen')
   and column_name in ('menge', 'einzelpreis', 'gesamtpreis', 'ust_satz',
                       'netto_summe', 'ust_betrag', 'brutto_summe')
 order by 1, 2;

-- 1) Übersicht Rechnungspositionen (eine Zeile)
select
  count(*)                                                                    as positionen_gesamt,
  count(*) filter (where menge       <> round(menge, 2))                      as menge_mehr_als_2_nachkommastellen,
  count(*) filter (where einzelpreis <> round(einzelpreis, 2))                as einzelpreis_mehr_als_2_nachkommastellen,
  count(*) filter (where gesamtpreis <> round(gesamtpreis, 2))                as gesamtpreis_mehr_als_2_nachkommastellen,
  count(*) filter (where round(menge * einzelpreis, 2) <> gesamtpreis)        as menge_mal_preis_ungleich_gesamt,
  count(*) filter (where einzelpreis < 0)                                     as negativer_einzelpreis,
  count(*) filter (where menge < 0)                                           as negative_menge,
  count(*) filter (where menge = 0)                                           as menge_null
  from public.rechnungspositionen;

-- 2) Beispiele: Menge × Einzelpreis ≠ Gesamtpreis (gerundet auf 2 Stellen)
select r.rechnungsnummer, r.status, r.datum, p.position_nr, p.bezeichnung,
       p.menge, p.einzelpreis, p.gesamtpreis,
       round(p.menge * p.einzelpreis, 2)                as menge_mal_preis,
       p.gesamtpreis - round(p.menge * p.einzelpreis, 2) as differenz
  from public.rechnungspositionen p
  join public.rechnungen r on r.id = p.rechnung_id
 where round(p.menge * p.einzelpreis, 2) <> p.gesamtpreis
 order by r.datum desc, r.rechnungsnummer, p.position_nr
 limit 50;

-- 3) Beispiele: negativer Einzelpreis (in der E-Rechnung nicht zulässig —
--    ein Abzug müsste als negative Menge erscheinen; Frage für später)
select r.rechnungsnummer, r.status, r.datum, p.position_nr, p.bezeichnung,
       p.menge, p.einzelpreis, p.gesamtpreis
  from public.rechnungspositionen p
  join public.rechnungen r on r.id = p.rechnung_id
 where p.einzelpreis < 0
 order by r.datum desc
 limit 50;

-- 4) Summen der Rechnung gegen die Positionen nachgerechnet
--    (USt je Steuersatz gerundet — genauso rechnen PDF und E-Rechnung).
--    Nur Abweichungen werden gelistet.
with je_satz as (
  select p.rechnung_id,
         coalesce(p.ust_satz, r.ust_satz) as satz,
         sum(p.gesamtpreis)               as netto
    from public.rechnungspositionen p
    join public.rechnungen r on r.id = p.rechnung_id
   group by p.rechnung_id, coalesce(p.ust_satz, r.ust_satz)
), nachgerechnet as (
  select rechnung_id,
         round(sum(netto), 2)                          as netto,
         sum(round(netto * satz / 100, 2))             as ust,
         count(*)                                      as anzahl_saetze
    from je_satz
   group by rechnung_id
)
select r.rechnungsnummer, r.status, r.datum, n.anzahl_saetze,
       r.netto_summe  as netto_gespeichert,  n.netto        as netto_nachgerechnet,
       r.ust_betrag   as ust_gespeichert,    n.ust          as ust_nachgerechnet,
       r.brutto_summe as brutto_gespeichert, n.netto + n.ust as brutto_nachgerechnet
  from public.rechnungen r
  join nachgerechnet n on n.rechnung_id = r.id
 where r.netto_summe  <> n.netto
    or r.ust_betrag   <> n.ust
    or r.brutto_summe <> n.netto + n.ust
 order by r.datum desc
 limit 100;

-- 5) Zusammenfassung zu 4) nach Status
with je_satz as (
  select p.rechnung_id, coalesce(p.ust_satz, r.ust_satz) as satz, sum(p.gesamtpreis) as netto
    from public.rechnungspositionen p join public.rechnungen r on r.id = p.rechnung_id
   group by p.rechnung_id, coalesce(p.ust_satz, r.ust_satz)
), n as (
  select rechnung_id, round(sum(netto), 2) as netto, sum(round(netto * satz / 100, 2)) as ust
    from je_satz group by rechnung_id
)
select r.status,
       count(*)                                                        as rechnungen,
       count(*) filter (where r.netto_summe <> n.netto
                           or r.ust_betrag <> n.ust
                           or r.brutto_summe <> n.netto + n.ust)       as mit_abweichung
  from public.rechnungen r join n on n.rechnung_id = r.id
 group by r.status
 order by r.status;

-- 6) Nur zur Info: Gutschriftspositionen (Spalten ohne feste
--    Nachkommastellen; Gutschriften sind von der E-Rechnung vorerst
--    ausgenommen, siehe Fragen S1/S2)
select
  count(*)                                                             as positionen_gesamt,
  count(*) filter (where menge       <> round(menge, 2))               as menge_mehr_als_2_nachkommastellen,
  count(*) filter (where einzelpreis <> round(einzelpreis, 2))         as einzelpreis_mehr_als_2_nachkommastellen,
  count(*) filter (where gesamtpreis <> round(gesamtpreis, 2))         as gesamtpreis_mehr_als_2_nachkommastellen,
  count(*) filter (where round(menge * einzelpreis, 2) <> round(gesamtpreis, 2)) as menge_mal_preis_ungleich_gesamt,
  count(*) filter (where einzelpreis < 0)                              as negativer_einzelpreis
  from public.gutschriftspositionen;
