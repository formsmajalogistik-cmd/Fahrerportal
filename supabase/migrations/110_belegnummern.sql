-- Rechnungsnummern: Vergabe robust und formatunabhängig, Unique absichern.
--
-- Anlass: Seit „Re_26/1000" sortiert die Übersicht diese Rechnung hinter
-- die 990er — die Liste sortierte die Nummer als TEXT ("1" < "9"). Die
-- Vergabe selbst (Migration 040/042) rechnete bereits mit dem Zahlteil,
-- hatte aber zwei Schwächen:
--   * nur Nummern der Form 'Re-{Jahr}/N' zählten — eine Serie in anderer
--     Schreibweise (z.B. 'Re_26/N') wurde nicht erkannt;
--   * eine handgetippte Nummer mit Buchstaben am Ende im selben Muster
--     ('Re-2026/12a') ließ den ::int-Cast scheitern → keine Vergabe mehr.
--
-- Neu:
--   * beleg_nr_praefix / beleg_nr_lauf zerlegen jede Nummer in
--     „alles bis zur letzten Ziffernfolge" + laufende Zahl (numerisch).
--   * rechnungs_serie(Jahr) bestimmt, in welcher Serie weitergezählt wird:
--     die zuletzt benutzte der regelmäßig (≥ 3×) vorkommenden Serien des
--     Jahres; im neuen Jahr die Vorjahres-Serie mit neuer Jahreszahl;
--     sonst wie bisher 'Re-{Jahr}/'. Das Format bleibt damit so, wie die
--     Rechnungen bisher aussehen — keine führenden Nullen, nichts wird
--     umbenannt.
--   * next_rechnungsnummer / assign_rechnungsnummer: Maximum NUMERISCH
--     innerhalb der Serie + 1, unter einer Sperre — zwei gleichzeitig
--     angelegte Rechnungen bekommen verschiedene Nummern.
--   * Unique auf rechnungen.rechnungsnummer / gutschriften.gutschrift_nr
--     wird nur ergänzt, falls er fehlt UND keine Duplikate existieren.
--     Bei Duplikaten: Hinweis (NOTICE), nichts wird umnummeriert.
--
-- Bestehende Rechnungen, Nummern, Beträge und PDFs werden NICHT verändert.
-- Idempotent.

create or replace function public.beleg_nr_praefix(p_nr text)
returns text language sql immutable parallel safe as $$
  select case when m is null then null else coalesce(m[1], '') end
    from (select regexp_match(btrim(coalesce(p_nr, '')), '^(.*[^0-9])?([0-9]+)$') as m) s
$$;

create or replace function public.beleg_nr_lauf(p_nr text)
returns bigint language sql immutable parallel safe as $$
  -- Mehr als 15 Ziffern ist keine laufende Nummer mehr (Überlauf vermeiden).
  select case when m is null or length(m[2]) > 15 then null else m[2]::bigint end
    from (select regexp_match(btrim(coalesce(p_nr, '')), '^(.*[^0-9])?([0-9]+)$') as m) s
$$;

comment on function public.beleg_nr_lauf(text) is
  'Laufende Zahl am Ende einer Beleg-Nummer (Re_26/1000 → 1000), NULL wenn keine. Für numerische Sortierung/Vergabe.';

create or replace function public.rechnungs_serie(p_year integer)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v      text;
  v_alt  text;
  yy     text := lpad((p_year % 100)::text, 2, '0');
  yy_alt text := lpad(((p_year - 1) % 100)::text, 2, '0');
begin
  select beleg_nr_praefix(r.rechnungsnummer) into v
    from rechnungen r
   where extract(year from r.datum) = p_year
     and beleg_nr_lauf(r.rechnungsnummer) is not null
   group by 1
   order by (count(*) >= 3) desc, max(r.created_at) desc, count(*) desc
   limit 1;
  if v is not null then return v; end if;

  -- Neues Jahr: Serie des Vorjahres mit neuer Jahreszahl fortsetzen.
  select beleg_nr_praefix(r.rechnungsnummer) into v_alt
    from rechnungen r
   where extract(year from r.datum) = p_year - 1
     and beleg_nr_lauf(r.rechnungsnummer) is not null
   group by 1
   order by (count(*) >= 3) desc, max(r.created_at) desc, count(*) desc
   limit 1;
  if v_alt is not null then
    if position((p_year - 1)::text in v_alt) > 0 then
      return replace(v_alt, (p_year - 1)::text, p_year::text);
    end if;
    if v_alt ~ ('(^|[^0-9])' || yy_alt || '([^0-9]|$)') then
      return regexp_replace(v_alt, '(^|[^0-9])' || yy_alt || '([^0-9]|$)', '\1' || yy || '\2');
    end if;
  end if;

  return 'Re-' || p_year || '/';
end;
$$;

create or replace function public.next_rechnungsnummer(p_year integer default extract(year from current_date)::int)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_serie text;
  v_next  bigint;
begin
  -- Eine Sperre für die gesamte Rechnungs-Nummernvergabe (Transaktion):
  -- parallele Inserts warten aufeinander und sehen die neue Nummer.
  perform pg_advisory_xact_lock(73436000000);
  v_serie := rechnungs_serie(p_year);
  select coalesce(max(beleg_nr_lauf(r.rechnungsnummer)), 0) + 1 into v_next
    from rechnungen r
   where beleg_nr_praefix(r.rechnungsnummer) = v_serie;
  return v_serie || v_next::text;
end;
$$;

revoke all on function public.next_rechnungsnummer(integer) from public;
grant execute on function public.next_rechnungsnummer(integer) to authenticated;

create or replace function public.assign_rechnungsnummer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rechnungsnummer is not null and btrim(new.rechnungsnummer) <> '' then
    return new;
  end if;
  new.rechnungsnummer := next_rechnungsnummer(extract(year from coalesce(new.datum, current_date))::int);
  return new;
end;
$$;

drop trigger if exists rechnungen_assign_rechnungsnummer on public.rechnungen;
create trigger rechnungen_assign_rechnungsnummer
  before insert on public.rechnungen
  for each row execute function public.assign_rechnungsnummer();

-- Unique nur ergänzen, wenn er fehlt und keine Duplikate existieren.
do $$
declare
  v_dup int;
begin
  if not exists (
    select 1 from pg_index ix join pg_class t on t.oid = ix.indrelid
     where t.oid = 'public.rechnungen'::regclass and ix.indisunique
       and pg_get_indexdef(ix.indexrelid) ~ '\(rechnungsnummer\)'
  ) then
    select count(*) into v_dup from (
      select 1 from public.rechnungen group by rechnungsnummer having count(*) > 1) d;
    if v_dup = 0 then
      alter table public.rechnungen add constraint rechnungen_rechnungsnummer_key unique (rechnungsnummer);
    else
      raise notice 'rechnungen: % doppelte Rechnungsnummer(n) — Unique NICHT angelegt, bitte Liste prüfen (supabase/scripts/rechnungsnummern_pruefung.sql).', v_dup;
    end if;
  end if;

  if not exists (
    select 1 from pg_index ix join pg_class t on t.oid = ix.indrelid
     where t.oid = 'public.gutschriften'::regclass and ix.indisunique
       and pg_get_indexdef(ix.indexrelid) ~ '\(gutschrift_nr\)'
  ) then
    select count(*) into v_dup from (
      select 1 from public.gutschriften group by gutschrift_nr having count(*) > 1) d;
    if v_dup = 0 then
      alter table public.gutschriften add constraint gutschriften_gutschrift_nr_key unique (gutschrift_nr);
    else
      raise notice 'gutschriften: % doppelte Gutschriftsnummer(n) — Unique NICHT angelegt.', v_dup;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
