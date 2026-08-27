-- Migration 093: Einheitliche Schreibweise im Vorschlags-Pool
--
-- „bremen", „Bremen" und „BREMEN" standen bisher als drei getrennte
-- Einträge im selben Topf. Ab sofort normalisiert das Frontend beim
-- Sammeln und bei manuellen Einträgen (src/lib/textNormalisierung.ts);
-- diese Migration zieht die Bestandsdaten einmalig nach und führt die
-- entstehenden Dubletten zusammen — die Häufigkeiten werden dabei
-- addiert, nicht überschrieben.
--
-- Die SQL-Funktionen bilden dieselben Regeln ab wie das Frontend:
--   * jedes Wort beginnt groß, Bindestriche trennen mit
--   * durchgehend groß geschriebene Wörter bleiben („BMW", „HB-AB 123")
--   * der Rest des Wortes bleibt unangetastet („GmbH", „McDonald")
--   * Hausnummern bleiben, wie sie sind („38e" wird nicht „38E")
--   * E-Mail wird klein, Telefon und PLZ bleiben unverändert
--
-- Idempotent: ein zweiter Lauf ändert nichts mehr.

-- ------------------------------------------------------------
-- 1. Hilfsfunktionen
-- ------------------------------------------------------------
create or replace function public.maja_wort_gross(w text)
returns text
language sql
immutable
as $$
  select case
    -- Rechtsformen zuerst — sonst käme „GMBH" über die Akronym-Regel
    -- unverändert durch und „gmbh" würde zu „Gmbh".
    when lower(w) = 'gmbh' then 'GmbH'
    when lower(w) = 'mbh'  then 'mbH'
    when lower(w) = 'ohg'  then 'OHG'
    when lower(w) = 'gbr'  then 'GbR'
    when w = ''            then w
    -- Akronyme und Kennzeichen unverändert lassen.
    when length(w) > 1 and w = upper(w) then w
    else upper(left(w, 1)) || substr(w, 2)
  end;
$$;

create or replace function public.maja_gross_anfang(wert text)
returns text
language plpgsql
immutable
as $$
declare
  ergebnis text := '';
  wort     text := '';
  c        text;
  i        int;
begin
  if wert is null then return null; end if;
  -- Zeichenweise: Buchstaben/Ziffern sammeln, alles andere (Leerzeichen,
  -- Bindestrich, Punkt, /) trennt ein Wort ab und wird direkt übernommen.
  for i in 1..length(wert) loop
    c := substr(wert, i, 1);
    if c ~ '[[:alnum:]]' then
      wort := wort || c;
    else
      ergebnis := ergebnis || public.maja_wort_gross(wort) || c;
      wort := '';
    end if;
  end loop;
  return ergebnis || public.maja_wort_gross(wort);
end;
$$;

/*
 * Schreibweise passend zum Topf. Spiegelt normalisiereFuerTyp() im
 * Frontend — inklusive der Endungs-Prüfung, damit auch Töpfe mit
 * eigener Basis („abholung_strasse") erkannt werden.
 */
create or replace function public.maja_vorschlag_schreibweise(feld_typ text, wert text)
returns text
language sql
immutable
as $$
  with v as (
    select lower(btrim(coalesce(feld_typ, ''))) as t,
           btrim(regexp_replace(coalesce(wert, ''), '\s+', ' ', 'g')) as w
  )
  select case
    when w = '' then w
    when t = 'email'   or t like '%\_email'   then lower(w)
    when t = 'telefon' or t like '%\_telefon' then w
    when t = 'plz'     or t like '%\_plz'     then w
    when t in ('adresse_strasse', 'adresse_stadt', 'firma', 'kontaktname', 'fahrzeugmodell')
      or t like '%\_strasse' or t like '%\_stadt'
      then public.maja_gross_anfang(w)
    else w
  end
  from v;
$$;

-- ------------------------------------------------------------
-- 2. Bestand normalisieren + Dubletten zusammenführen
--
--    Gruppiert wird über die NORMALISIERTE Schreibweise (klein
--    verglichen). Damit fallen auch Fälle zusammen, die sich nur in
--    Leerzeichen unterscheiden — sonst liefe das anschließende Update
--    in die Unique-Bedingung (feld_typ, wert).
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select
      feld_typ,
      lower(public.maja_vorschlag_schreibweise(feld_typ, wert)) as schluessel,
      -- Behalten wird der manuell gepflegte bzw. häufigste Eintrag; die
      -- id als letztes Kriterium macht den Lauf reproduzierbar.
      (array_agg(id order by ist_manuell desc, anzahl desc, id))[1] as behalten,
      sum(anzahl)          as summe,
      max(letzte_nutzung)  as letzte,
      bool_or(ist_manuell) as manuell
    from public.feld_vorschlaege
    group by 1, 2
  loop
    delete from public.feld_vorschlaege
     where feld_typ = r.feld_typ
       and lower(public.maja_vorschlag_schreibweise(feld_typ, wert)) = r.schluessel
       and id <> r.behalten;

    update public.feld_vorschlaege
       set wert           = public.maja_vorschlag_schreibweise(feld_typ, wert),
           anzahl         = r.summe,
           letzte_nutzung = r.letzte,
           ist_manuell    = r.manuell
     where id = r.behalten;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 3. Adressbuch nachziehen
--
--    Keine Unique-Bedingung, deshalb reicht ein einfaches Update.
--    PLZ bleibt unangetastet.
-- ------------------------------------------------------------
update public.adressbuch
   set bezeichnung = public.maja_gross_anfang(bezeichnung),
       strasse     = public.maja_gross_anfang(strasse),
       ort         = public.maja_gross_anfang(ort)
 where bezeichnung is distinct from public.maja_gross_anfang(bezeichnung)
    or strasse     is distinct from public.maja_gross_anfang(strasse)
    or ort         is distinct from public.maja_gross_anfang(ort);

notify pgrst, 'reload schema';
