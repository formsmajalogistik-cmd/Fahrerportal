-- Adress-Pool: Dubletten zusammenführen — EIN BLOCK pro Ausführung.
--
-- So oft ausführen, bis „offen_danach" 0 meldet. Jeder Lauf bearbeitet
-- höchstens 500 Wertgruppen und bleibt damit weit innerhalb des
-- Editor-Timeouts.
--
-- Was passiert: Werte, die sich nach der Normalisierung nur in der
-- Schreibweise unterscheiden („bremen" / „Bremen" / „BREMEN"), werden zu
-- einem Eintrag. `anzahl` wird ADDIERT, `letzte_nutzung` auf den
-- jüngsten Wert gesetzt, ein manuell gepflegter Eintrag bleibt manuell.
-- Die überzähligen Zeilen werden gelöscht.
--
-- Beliebig oft wiederholbar: ist nichts mehr offen, ändert der Lauf
-- nichts.
--
-- ZUERST vorschlaege_status.sql ausführen. Reihenfolge insgesamt:
--   1. dieses Skript (Dubletten) bis 0
--   2. vorschlaege_normalisieren_block.sql (Schreibweise) bis 0
-- Die Dubletten müssen zuerst weg, weil ein Umbenennen sonst in die
-- Eindeutigkeit (feld_typ, wert) laufen würde.

with gruppen as (
  select feld_typ, lower(public.maja_vorschlag_schreibweise(feld_typ, wert)) as schluessel
  from public.feld_vorschlaege
  group by 1, 2
  having count(*) > 1
  limit 500
),
zeilen as (
  select f.id, f.feld_typ, f.anzahl, f.letzte_nutzung, f.ist_manuell, g.schluessel
  from public.feld_vorschlaege f
  join gruppen g
    on g.feld_typ = f.feld_typ
   and g.schluessel = lower(public.maja_vorschlag_schreibweise(f.feld_typ, f.wert))
),
ziel as (
  select
    feld_typ, schluessel,
    -- Behalten wird der manuell gepflegte bzw. häufigste Eintrag.
    (array_agg(id order by ist_manuell desc, anzahl desc, id))[1] as behalten,
    sum(anzahl)::int     as summe,
    max(letzte_nutzung)  as letzte,
    bool_or(ist_manuell) as manuell
  from zeilen
  group by feld_typ, schluessel
),
uebernommen as (
  update public.feld_vorschlaege fv
     set anzahl         = z.summe,
         letzte_nutzung = z.letzte,
         ist_manuell    = z.manuell
    from ziel z
   where fv.id = z.behalten
  returning fv.id
),
entfernt as (
  delete from public.feld_vorschlaege fv
   using zeilen zl
   join  ziel   z on z.feld_typ = zl.feld_typ and z.schluessel = zl.schluessel
   where fv.id = zl.id
     and fv.id <> z.behalten
  returning fv.id
)
select
  (select count(*) from ziel)     as gruppen_bearbeitet,
  (select count(*) from entfernt) as zeilen_entfernt;

-- Wie viele Dubletten-Zeilen sind noch offen? 0 = fertig.
with normalisiert as (
  select feld_typ, public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
  from public.feld_vorschlaege
),
gruppen as (
  select count(*) as n
  from normalisiert
  group by feld_typ, lower(neu)
  having count(*) > 1
)
select coalesce(sum(n - 1), 0) as offen_danach from gruppen;
