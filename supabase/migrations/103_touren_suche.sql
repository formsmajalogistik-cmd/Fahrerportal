-- Touren über den GESAMTEN Bestand suchen.
--
-- Anlass: Touren von vor ca. zwei Monaten ließen sich nicht mehr finden —
-- weder über die Suche noch über die Filter. Ursache: Die Tourenliste lud
-- alle Touren in EINER Abfrage und filterte erst im Browser; PostgREST
-- liefert aber höchstens 1000 Zeilen. Bei absteigender Sortierung kamen
-- nur die jüngsten 1000 an (inkl. geplanter Zukunftstouren), alles davor
-- war unsichtbar — auch für die Suche.
--
-- Diese Migration:
--   * Such-Ausdrücke als IMMUTABLE-Funktionen + Trigramm-Indizes
--     (pg_trgm), damit `like '%…%'` über den Gesamtbestand schnell bleibt
--   * RPC `touren_suche`: serverseitige Suche ohne Datumsgrenze,
--     seitenweise, mit Gesamtzahl. Läuft unter der RLS des Aufrufers —
--     Fahrer finden nur eigene Touren, Auftraggeber (kein Direktzugriff
--     auf touren) gar keine; ihr Weg bleibt die Kundensicht.
--
-- Durchsucht: Tour-ID, Kennzeichen (Hin + Rück), FIN (Hin + Rück),
-- Start-/Ziel-/Rückführungs-Stadt, Kundenname, Fahrername.
-- Kennzeichen/FIN/Tour-ID zusätzlich „kompakt": ohne Leer- und
-- Satzzeichen, damit „HHAB1234" auch „HH-AB 1234" findet.

-- ------------------------------------------------------------
-- 1. pg_trgm — in Supabase üblicherweise im Schema `extensions`.
-- ------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------------
-- 2. Such-Ausdrücke
--
-- IMMUTABLE ist hier korrekt im Sinne des Index: die Ergebnisse hängen
-- nur an den Argumenten. (array_to_string ist formal nur STABLE, weil es
-- beliebige Typen ausgeben kann — für text[] ist es deterministisch.)
-- ------------------------------------------------------------

create or replace function public.tour_suchtext(
  p_tour_id text, p_start text, p_ziel text, p_rueck text, p_kunde text,
  p_kennzeichen text[], p_fin text, p_fin_rueck text
) returns text
language sql immutable parallel safe
as $$
  select lower(
    coalesce(p_tour_id, '') || ' ' || coalesce(p_start, '') || ' ' || coalesce(p_ziel, '') || ' '
    || coalesce(p_rueck, '') || ' ' || coalesce(p_kunde, '') || ' '
    || coalesce(array_to_string(p_kennzeichen, ' '), '') || ' '
    || coalesce(p_fin, '') || ' ' || coalesce(p_fin_rueck, '')
  )
$$;

-- Kompakt: nur Buchstaben/Ziffern, Felder durch | getrennt, damit ein
-- Treffer nicht über eine Feldgrenze hinweg entsteht.
create or replace function public.tour_suchtext_kompakt(
  p_tour_id text, p_kennzeichen text[], p_fin text, p_fin_rueck text
) returns text
language sql immutable parallel safe
as $$
  select regexp_replace(
    lower(coalesce(p_tour_id, '') || '|' || coalesce(array_to_string(p_kennzeichen, '|'), '')
          || '|' || coalesce(p_fin, '') || '|' || coalesce(p_fin_rueck, '')),
    '[^a-z0-9äöüß|]', '', 'g')
$$;

-- ------------------------------------------------------------
-- 3. Trigramm-Indizes. Der Operator-Klassen-Name hängt am Schema, in dem
--    pg_trgm installiert ist — das kann je nach Projekt `extensions` oder
--    `public` sein, daher dynamisch.
-- ------------------------------------------------------------
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  execute format(
    'create index if not exists touren_suchtext_trgm on public.touren using gin '
    || '(public.tour_suchtext(tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt, kundenname, kennzeichen, fin, fin_rueck) %I.gin_trgm_ops)', s);
  execute format(
    'create index if not exists touren_suchtext_kompakt_trgm on public.touren using gin '
    || '(public.tour_suchtext_kompakt(tour_id, kennzeichen, fin, fin_rueck) %I.gin_trgm_ops)', s);
end $$;

-- Sortierung der Treffer (Datum absteigend) und Datumsfilter der Liste.
create index if not exists touren_effektives_datum_idx
  on public.touren ((coalesce(enddatum, startdatum)) desc, created_at desc, id);

-- ------------------------------------------------------------
-- 4. RPC: Suche
--
-- p_fahrer_ids: optionale Eingrenzung (aktives Fahrer-Konto inkl.
-- Unterkonten) — zusätzlich zur RLS, nicht statt ihrer.
-- Rückgabe: Tour-IDs der Seite, sortiert nach Datum absteigend, plus die
-- Gesamtzahl aller Treffer.
-- ------------------------------------------------------------

create or replace function public.touren_suche(
  p_suche      text,
  p_fahrer_ids uuid[] default null,
  p_limit      int default 50,
  p_offset     int default 0
)
returns table (id uuid, gesamt bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with eingabe as (
    select
      -- % und _ wörtlich nehmen
      replace(replace(replace(lower(trim(coalesce(p_suche, ''))), '\', '\\'), '%', '\%'), '_', '\_') as roh,
      regexp_replace(lower(coalesce(p_suche, '')), '[^a-z0-9äöüß]', '', 'g') as kompakt,
      lower(trim(coalesce(p_suche, ''))) as klar
  ),
  fahrer_treffer as (
    select f.id
    from public.fahrer f
    left join public.app_users u on u.id = f.user_id
    cross join eingabe e
    where length(e.klar) >= 2
      and (concat_ws(' ', f.vorname, f.nachname) ilike '%' || e.roh || '%'
           or concat_ws(' ', u.vorname, u.nachname) ilike '%' || e.roh || '%')
  ),
  treffer as (
    select t.id, coalesce(t.enddatum, t.startdatum) as datum, t.created_at
    from public.touren t
    cross join eingabe e
    where length(e.klar) >= 2
      and (p_fahrer_ids is null or t.fahrer_id = any(p_fahrer_ids))
      and (
        public.tour_suchtext(t.tour_id, t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt,
                             t.kundenname, t.kennzeichen, t.fin, t.fin_rueck) like '%' || e.roh || '%'
        or (length(e.kompakt) >= 2 and
            public.tour_suchtext_kompakt(t.tour_id, t.kennzeichen, t.fin, t.fin_rueck) like '%' || e.kompakt || '%')
        or t.fahrer_id in (select ft.id from fahrer_treffer ft)
      )
  )
  select tr.id, count(*) over () as gesamt
  from treffer tr
  order by tr.datum desc nulls last, tr.created_at desc, tr.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.touren_suche(text, uuid[], int, int) is
  'Tour-Suche über den gesamten Bestand (ohne Datumsgrenze), seitenweise, unter der RLS des Aufrufers.';

grant execute on function public.touren_suche(text, uuid[], int, int) to authenticated;

notify pgrst, 'reload schema';
