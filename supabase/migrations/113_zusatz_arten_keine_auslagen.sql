-- Zusatz-Arten „zählt als Auslage" + „Keine Auslagen" als Zusatz je Kennzeichen.
--
-- Korrektur zu Migration 112 (Prompt 117):
--
-- 1) Nicht jeder Zusatz ist eine Auslage. Maut, Wartezeit, Rote
--    Kennzeichen, Reifenhandling und Wäsche werden weiter berechnet,
--    klären aber den Auslagen-Status NICHT. Statt einer Liste im Code gibt
--    es die Tabelle zusatz_arten mit der Eigenschaft zaehlt_als_auslage.
--    Abgleich über einen Schlüssel ohne Groß/Klein, Leer-/Sonderzeichen
--    und Umlaute („Wäsche" = „waesche" = „ WÄSCHE "). Unbekannte Arten
--    zählen als Auslage.
--
-- 2) „Keine Auslagen" ist jetzt eine Zusatz-Art (tour_zusaetze.kategorie
--    'Keine Auslagen') und wie jeder Zusatz einem Kennzeichen zugeordnet
--    (Hin/Rück bei ABA/ABC). Gespeichert mit anzahl 1, betrag 0; sie
--    erscheint nie auf Rechnungen (Frontend überspringt sie beim Erzeugen
--    der Positionen). Maßgeblich ist nur noch dieser Zusatz — die
--    Markierung aus 112 (tour_keine_auslagen) wird nicht mehr ausgewertet,
--    bleibt aber erhalten; ihr Trigger entfällt.
--
-- Trigger an tour_zusaetze (je Kennzeichen):
--   * echte Auslage hinzugefügt/umgehängt → „Keine Auslagen" desselben
--     Kennzeichens (oder ohne Kennzeichen) wird entfernt + protokolliert
--   * Zusätze, die nicht als Auslage zählen (Maut …), entfernen nichts
--   * „Keine Auslagen" angelegt bzw. von Hand gelöscht → protokolliert
--
-- Übernahme der alten Markierungen: keine_auslagen_uebernahme_kandidaten()
-- liefert je markierter Tour die Kennzeichen ohne echte Auslage und ohne
-- „Keine Auslagen" — Probelauf/Ausführen über supabase/scripts/
-- (erst nach Bestätigung, idempotent).
--
-- Bestehende Rechnungen, Beträge und Zusätze werden NICHT verändert.
-- Idempotent.

create table if not exists public.zusatz_arten (
  schluessel         text primary key,
  bezeichnung        text not null,
  zaehlt_als_auslage boolean not null default true
);

comment on table public.zusatz_arten is
  'Eigenschaften je Zusatz-Art. schluessel = zusatz_art_schluessel(kategorie). Nicht aufgeführte Arten zählen als Auslage.';

alter table public.zusatz_arten enable row level security;
drop policy if exists zusatz_arten_lesen on public.zusatz_arten;
create policy zusatz_arten_lesen on public.zusatz_arten
  for select using (public.is_admin() or public.is_test());
drop policy if exists zusatz_arten_admin on public.zusatz_arten;
create policy zusatz_arten_admin on public.zusatz_arten
  for all using (public.is_admin() and not public.is_test()) with check (public.is_admin() and not public.is_test());
grant select, insert, update, delete on public.zusatz_arten to authenticated;

create or replace function public.zusatz_art_schluessel(p text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
           replace(replace(replace(replace(lower(coalesce(p, '')), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
           '[^a-z0-9]', '', 'g')
$$;

insert into public.zusatz_arten (schluessel, bezeichnung, zaehlt_als_auslage) values
  ('maut',                  'Maut',                   false),
  ('wartezeit',             'Wartezeit',              false),
  ('rotekennzeichen',       'Rote Kennzeichen',       false),
  ('reifenhandling',        'Reifenhandling',         false),
  ('waesche',               'Wäsche',                 false),
  ('keineauslagen',         'Keine Auslagen',         false),
  ('ladezeit',              'Ladezeit',               true),
  ('tankauslagen',          'Tankauslagen',           true),
  ('ladeauslagen',          'Ladeauslagen',           true),
  ('waschauslagen',         'Waschauslagen',          true),
  ('tankundwaschauslagen',  'Tank und Waschauslagen', true),
  ('ladeundwaschauslagen',  'Lade und Waschauslagen', true),
  ('taxiauslagen',          'Taxiauslagen',           true)
on conflict (schluessel) do nothing;

create or replace function public.zusatz_ist_keine_auslagen(p text)
returns boolean language sql immutable parallel safe as $$
  select public.zusatz_art_schluessel(p) = 'keineauslagen'
$$;

create or replace function public.zusatz_ist_auslage(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select not zusatz_ist_keine_auslagen(p)
     and coalesce((select a.zaehlt_als_auslage from zusatz_arten a where a.schluessel = zusatz_art_schluessel(p)), true)
$$;

/** Kennzeichen tolerant vergleichbar (wie normFahrzeugWert im Frontend). */
create or replace function public.kz_norm(p text)
returns text language sql immutable parallel safe as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s\-‐‑–—]+', '', 'g'))
$$;

-- Änderungsprotokoll: Quelle 'auslagen' gibt es seit 112.

-- Alter Trigger aus 112 (Markierung an der Tour) entfällt — die
-- Markierung wird nicht mehr ausgewertet, bleibt aber gespeichert.
drop trigger if exists tka_zusatz on public.tour_zusaetze;

create or replace function public.keine_auslagen_protokoll(p_tour_id uuid, p_alt text, p_neu text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from touren where id = p_tour_id) then return; end if;  -- Tour wird gelöscht
  insert into tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
  values (p_tour_id, auth.uid(), 'keine_auslagen', p_alt, p_neu, 'auslagen', now(), auth.uid());
end;
$$;
revoke all on function public.keine_auslagen_protokoll(uuid, text, text) from public;

create or replace function public.keine_auslagen_kz_text(p text)
returns text language sql immutable as $$
  select case when nullif(btrim(coalesce(p, '')), '') is null then 'ohne Kennzeichen' else 'Kennzeichen ' || btrim(p) end
$$;

create or replace function public.keine_auslagen_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then
    if zusatz_ist_keine_auslagen(old.kategorie) and coalesce(current_setting('maja.keine_auslagen_auto', true), '') <> '1' then
      perform keine_auslagen_protokoll(old.tour_id, '„Keine Auslagen" (' || keine_auslagen_kz_text(old.kennzeichen) || ')',
        '„Keine Auslagen" entfernt (' || keine_auslagen_kz_text(old.kennzeichen) || ')');
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.tour_id is not distinct from old.tour_id
     and new.kennzeichen is not distinct from old.kennzeichen
     and new.kategorie is not distinct from old.kategorie then
    return new;
  end if;

  if zusatz_ist_keine_auslagen(new.kategorie) then
    if tg_op = 'INSERT' then
      perform keine_auslagen_protokoll(new.tour_id, null,
        '„Keine Auslagen" angelegt (' || keine_auslagen_kz_text(new.kennzeichen) || ')');
    end if;
    return new;
  end if;

  if zusatz_ist_auslage(new.kategorie) then
    perform set_config('maja.keine_auslagen_auto', '1', true);
    for r in
      delete from tour_zusaetze z
       where z.tour_id = new.tour_id
         and z.id <> new.id
         and zusatz_ist_keine_auslagen(z.kategorie)
         and (nullif(btrim(coalesce(z.kennzeichen, '')), '') is null
              or nullif(btrim(coalesce(new.kennzeichen, '')), '') is null
              or kz_norm(z.kennzeichen) = kz_norm(new.kennzeichen))
      returning z.kennzeichen
    loop
      perform keine_auslagen_protokoll(new.tour_id, '„Keine Auslagen" (' || keine_auslagen_kz_text(r.kennzeichen) || ')',
        '„Keine Auslagen" entfernt (' || keine_auslagen_kz_text(r.kennzeichen) || '), weil Auslage hinzugefügt ('
        || coalesce(new.kategorie, 'Zusatz') || ')');
    end loop;
    perform set_config('maja.keine_auslagen_auto', '', true);
  end if;
  return new;
end;
$$;

drop trigger if exists keine_auslagen_zusatz on public.tour_zusaetze;
create trigger keine_auslagen_zusatz
  after insert or update of tour_id, kennzeichen, kategorie or delete on public.tour_zusaetze
  for each row execute function public.keine_auslagen_trigger();

-- ------------------------------------------------------------
-- Übernahme der alten Markierungen (112): Kandidaten je Kennzeichen.
-- Nur lesen — geschrieben wird über supabase/scripts/.
-- ------------------------------------------------------------
create or replace function public.keine_auslagen_uebernahme_kandidaten()
returns table (tour_id uuid, tour_nr text, tourenart text, rolle text, kennzeichen text)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select x.id, x.tour_id as nr, x.tourenart, x.kennzeichen
      from touren x
     where x.id in (select m.tour_id from tour_keine_auslagen m)
  ), slots as (
    select t.id, t.nr, t.tourenart, case when t.tourenart in ('ABA', 'ABC') then 'hin' else 'einzig' end as rolle,
           nullif(btrim(coalesce(t.kennzeichen[1], '')), '') as kz
      from t
    union all
    select t.id, t.nr, t.tourenart, 'rueck', nullif(btrim(coalesce(t.kennzeichen[2], '')), '')
      from t where t.tourenart in ('ABA', 'ABC')
  )
  select s.id, s.nr, s.tourenart, s.rolle, s.kz
    from slots s
   where not exists (
     select 1 from tour_zusaetze z
      where z.tour_id = s.id
        and (zusatz_ist_auslage(z.kategorie) or zusatz_ist_keine_auslagen(z.kategorie))
        and (nullif(btrim(coalesce(z.kennzeichen, '')), '') is null or s.kz is null
             or kz_norm(z.kennzeichen) = kz_norm(s.kz)))
   order by s.nr, s.rolle
$$;
revoke all on function public.keine_auslagen_uebernahme_kandidaten() from public, authenticated, anon;

notify pgrst, 'reload schema';
