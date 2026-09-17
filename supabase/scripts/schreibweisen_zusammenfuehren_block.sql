-- Schreibweisen zusammenführen — EIN BLOCK pro Ausführung. ÄNDERT DATEN.
--
-- ERST schreibweisen_trockenlauf.sql laufen lassen und freigeben.
--
-- Gruppiert über den Vergleichsschlüssel. Je Gruppe:
--   * `anzahl` wird addiert
--   * `letzte_nutzung` auf den jüngsten Wert gesetzt
--   * ein manuell gepflegter Eintrag bleibt manuell
--   * behalten wird die HÄUFIGSTE Original-Schreibweise — nur getrimmt
--     (führende/abschließende Leerzeichen, Kommas, Semikolons) und mit
--     großem Anfangsbuchstaben. Es wird NICHTS umgeschrieben:
--     „Heiligenroder Strasse" bleibt „Heiligenroder Strasse".
--   * die übrigen Zeilen werden entfernt
--
-- Höchstens 500 Gruppen pro Lauf. So oft ausführen, bis „offen_danach"
-- 0 meldet. Beliebig oft wiederholbar.

with gruppen as (
  select feld_typ, public.maja_vergleichsschluessel(wert) as schluessel
  from public.feld_vorschlaege
  group by 1, 2
  having count(*) > 1
  limit 500
),
zeilen as (
  select f.id, f.feld_typ, f.wert, f.anzahl, f.letzte_nutzung, f.ist_manuell,
         g.schluessel
  from public.feld_vorschlaege f
  join gruppen g
    on g.feld_typ = f.feld_typ
   and g.schluessel = public.maja_vergleichsschluessel(f.wert)
),
ziel as (
  select
    feld_typ, schluessel,
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
    (array_agg(id order by
       ist_manuell desc,
       anzahl desc,
       (wert ~ ' [,;]' or wert ~ ',[^ ]' or wert ~ '  '),
       length(wert) desc,
       length(wert) - length(replace(wert, ' ', '')),
       id))[1] as behalten,
    (array_agg(wert order by
       ist_manuell desc,
       anzahl desc,
       (wert ~ ' [,;]' or wert ~ ',[^ ]' or wert ~ '  '),
       length(wert) desc,
       length(wert) - length(replace(wert, ' ', '')),
       id))[1] as behalten_wert,
    sum(anzahl)::int     as summe,
    max(letzte_nutzung)  as letzte,
    bool_or(ist_manuell) as manuell
  from zeilen
  group by feld_typ, schluessel
),
uebernommen as (
  update public.feld_vorschlaege fv
     set wert = (select upper(left(b, 1)) || substr(b, 2)
                   from (select btrim(z.behalten_wert, ' ,;') as b) t),
         anzahl         = z.summe,
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

-- Wie viele Zeilen fallen noch weg? 0 = fertig.
with gruppen as (
  select count(*) as n
  from public.feld_vorschlaege
  group by feld_typ, public.maja_vergleichsschluessel(wert)
  having count(*) > 1
)
select coalesce(sum(n - 1), 0) as offen_danach from gruppen;
