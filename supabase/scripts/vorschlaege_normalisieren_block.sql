-- Adress-Pool: Schreibweise vereinheitlichen — EIN BLOCK pro Ausführung.
--
-- So oft ausführen, bis „offen_danach" 0 meldet. Jeder Lauf bearbeitet
-- höchstens 500 Zeilen und bleibt damit weit innerhalb des
-- Editor-Timeouts.
--
-- Was passiert: „bremen" wird zu „Bremen", „stuhr-heiligenrode" zu
-- „Stuhr-Heiligenrode", E-Mail-Adressen werden klein geschrieben. PLZ,
-- Telefonnummern, Kürzel („BMW", „ZOB", „HB-AB 123") und Hausnummern
-- bleiben unverändert.
--
-- Beliebig oft wiederholbar: ist nichts mehr offen, ändert der Lauf
-- nichts.
--
-- ZUERST vorschlaege_duplikate_block.sql laufen lassen — Zeilen, deren
-- neue Schreibweise es schon gibt, werden hier bewusst übersprungen
-- (sonst verletzt das Umbenennen die Eindeutigkeit). Bleibt
-- „offen_danach" trotz mehrerer Läufe stehen, ist noch eine Dublette da:
-- dann wieder das Duplikat-Skript ausführen.

with kandidaten as (
  select id, feld_typ,
         public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
  from public.feld_vorschlaege
  where wert is distinct from public.maja_vorschlag_schreibweise(feld_typ, wert)
  limit 500
),
geaendert as (
  update public.feld_vorschlaege fv
     set wert = k.neu
    from kandidaten k
   where fv.id = k.id
     and not exists (
       select 1 from public.feld_vorschlaege x
        where x.feld_typ = k.feld_typ and x.wert = k.neu and x.id <> k.id
     )
  returning fv.id
)
select
  (select count(*) from kandidaten) as geprueft,
  (select count(*) from geaendert)  as zeilen_geaendert;

-- Adressbuch (manuelle Adressen) nachziehen — dort gibt es keine
-- Eindeutigkeits-Bedingung, ein Lauf reicht in aller Regel.
with kandidaten as (
  select id from public.adressbuch a
   where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
      or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
      or a.ort         is distinct from public.maja_gross_anfang(a.ort)
   limit 500
),
geaendert as (
  update public.adressbuch a
     set bezeichnung = public.maja_gross_anfang(a.bezeichnung),
         strasse     = public.maja_gross_anfang(a.strasse),
         ort         = public.maja_gross_anfang(a.ort)
    from kandidaten k
   where a.id = k.id
  returning a.id
)
select (select count(*) from geaendert) as adressbuch_geaendert;

-- Wie viele Zeilen sind noch offen? 0 = fertig.
select
  (select count(*) from public.feld_vorschlaege
    where wert is distinct from public.maja_vorschlag_schreibweise(feld_typ, wert))
  + (select count(*) from public.adressbuch a
      where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
         or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
         or a.ort         is distinct from public.maja_gross_anfang(a.ort))
  as offen_danach;
