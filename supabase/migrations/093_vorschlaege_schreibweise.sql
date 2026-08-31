-- Migration 093: Einheitliche Schreibweise im Vorschlags-Pool
--
-- „bremen", „Bremen" und „BREMEN" standen bisher als drei getrennte
-- Einträge im selben Topf. Ab sofort normalisiert das Frontend beim
-- Sammeln und bei manuellen Einträgen (src/lib/textNormalisierung.ts);
-- diese Migration legt die dazu passenden SQL-Funktionen an. Die
-- Bestandsdaten werden NICHT hier umgestellt, sondern blockweise —
-- siehe Abschnitt 2.
--
-- Die SQL-Funktionen bilden dieselben Regeln ab wie das Frontend:
--   * jedes Wort beginnt groß, Bindestriche trennen mit
--   * durchgehend groß geschriebene Wörter bleiben („BMW", „HB-AB 123")
--   * der Rest des Wortes bleibt unangetastet („GmbH", „McDonald")
--   * Hausnummern bleiben, wie sie sind („38e" wird nicht „38E")
--   * E-Mail wird klein, Telefon und PLZ bleiben unverändert
--
-- Idempotent und schnell: nur Funktionsdefinitionen.

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
    -- Durchgehend groß geschriebene Wörter bleiben nur stehen, wenn es
    -- plausibel Kürzel sind: höchstens drei Zeichen („BMW", „ZOB", „HB")
    -- oder mit einer Ziffer darin (Kennzeichen, Hausnummern). Sonst
    -- bliebe versehentlich getipptes „BREMEN" für immer so stehen und
    -- stünde als eigener Eintrag neben „Bremen".
    when length(w) > 1 and w = upper(w)
         and (length(w) <= 3 or w ~ '[0-9]') then w
    -- Sonst durchgehend groß geschrieben: Rest kleinschreiben, sonst
    -- bliebe „BREMEN" als „BREMEN" stehen.
    when length(w) > 1 and w = upper(w) then upper(left(w, 1)) || lower(substr(w, 2))
    -- Gemischte Schreibweise NICHT anfassen — „GmbH", „McDonald".
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
-- 2. Bestandsdaten laufen NICHT hier
--
-- Der ursprüngliche Einzeldurchlauf hat im SQL-Editor die Verbindung
-- überdauert („Failed to fetch"): er verglich für JEDE Gruppe die
-- komplette Tabelle über die Normalisierungs-Funktion — quadratischer
-- Aufwand, der bei einem gewachsenen Pool minutenlang läuft.
--
-- Diese Migration legt deshalb nur noch die Funktionen an (schnell und
-- gefahrlos wiederholbar). Die Bestandsbereinigung läuft blockweise:
--   * bequem über „Adress-Pool bereinigen" in der Pool-Pflege
--     (RPC aus Migration 094), oder
--   * von Hand über die Skripte in supabase/scripts/:
--       vorschlaege_status.sql          (nur lesen)
--       vorschlaege_normalisieren_block.sql
--       vorschlaege_duplikate_block.sql
--
-- Neu hinzukommende Werte werden ohnehin schon beim Speichern
-- normalisiert (Frontend + RPC aus Migration 094).
-- ------------------------------------------------------------

notify pgrst, 'reload schema';
