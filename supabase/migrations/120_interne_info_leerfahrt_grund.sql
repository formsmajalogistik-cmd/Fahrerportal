-- ============================================================
-- Maja-Logistik Business-Portal — 120: „Interne Info (nur Admin)" +
-- Leerfahrt mit Grund
-- ------------------------------------------------------------
-- touren_admin_info — eine Zeile je Tour (1:1 über tour_id):
--   * interne_info: Freitext, den ausschließlich Admins lesen und schreiben.
--   * leerfahrt_grund / leerfahrt_text: Grund der Leerfahrt strukturiert
--     (Code aus der zentralen Liste im Client, z.B. 'defekt', 'sonstiges';
--     bei 'sonstiges' ist der Text Pflicht).
--   * leerfahrt_zeile: die Zeile, die das System in interne_info geschrieben
--     hat. Nur wenn sie dort noch GENAU so steht, wird sie beim Ändern des
--     Grundes ersetzt bzw. beim Entfernen der Leerfahrt gelöscht — sonst
--     bleibt der Text unberührt und der Admin bekommt einen Hinweis.
--
-- Warum eine eigene Tabelle statt einer Spalte an touren: Fahrer,
-- Auftraggeber (über Views/RPCs) und das Test-Konto lesen touren. Alle
-- Nutzer teilen dieselbe Datenbankrolle, Spaltenrechte helfen also nicht
-- (siehe 063). Diese Tabelle hat RLS „nur Admin" für Lesen und Schreiben —
-- das Test-Konto (role = 'test') ist kein Admin und sieht nichts.
--
-- Weiter:
--   * Änderungsprotokoll der Tour (tour_aenderungen, nur Admin lesbar):
--     jede Änderung der internen Info, Quelle 'intern', gleich als gesehen.
--   * tour_leerfahrt_mit_grund(): Leerfahrt setzen/ändern/entfernen inkl.
--     Zeile in der internen Info (das bisherige Infofeld touren.info bleibt
--     unberührt). Die bestehende Leerfahrt-Logik (114) wird aufgerufen,
--     „Keine Auslagen" verhalten sich wie bisher.
--   * Tour-Split (106): interne Info + Grund werden auf die neue Tour kopiert.
--
-- Bestehende Touren, Infofelder, Leerfahrten und Rechnungen werden NICHT
-- verändert. Idempotent.
-- ============================================================

create table if not exists public.touren_admin_info (
  tour_id         uuid primary key references public.touren(id) on delete cascade,
  interne_info    text,
  leerfahrt_grund text,
  leerfahrt_text  text,
  leerfahrt_zeile text,
  geaendert_am    timestamptz not null default now(),
  geaendert_von   uuid
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'touren_admin_info_grund_check') then
    alter table public.touren_admin_info add constraint touren_admin_info_grund_check
      check (leerfahrt_grund is null or leerfahrt_grund ~ '^[a-z_]{1,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'touren_admin_info_sonstiges_check') then
    alter table public.touren_admin_info add constraint touren_admin_info_sonstiges_check
      check (leerfahrt_grund is distinct from 'sonstiges' or nullif(btrim(coalesce(leerfahrt_text, '')), '') is not null);
  end if;
end $$;

comment on table public.touren_admin_info is
  'Nur für Admins: interne Info zur Tour und Leerfahrt-Grund. Nie in Rechnung, E-Rechnung, E-Mails, Fahrer-/Auftraggeber-Ansicht.';

alter table public.touren_admin_info enable row level security;
drop policy if exists touren_admin_info_admin on public.touren_admin_info;
create policy touren_admin_info_admin on public.touren_admin_info
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.touren_admin_info from anon;
grant select, insert, update, delete on public.touren_admin_info to authenticated;

-- ---- Wer/wann
create or replace function public.touren_admin_info_stempel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.geaendert_am := now();
  new.geaendert_von := auth.uid();
  return new;
end;
$$;
drop trigger if exists touren_admin_info_stempel on public.touren_admin_info;
create trigger touren_admin_info_stempel
  before insert or update on public.touren_admin_info
  for each row execute function public.touren_admin_info_stempel();

-- ---- Änderungsprotokoll (Quelle 'intern', direkt als gesehen)
alter table public.tour_aenderungen drop constraint if exists tour_aenderungen_quelle_check;
alter table public.tour_aenderungen
  add constraint tour_aenderungen_quelle_check
  check (quelle in ('auftraggeber', 'verknuepfung', 'aufteilung', 'zuweisung', 'auslagen', 'leerfahrt', 'intern'));

create or replace function public.touren_admin_info_protokoll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt text := case when tg_op = 'INSERT' then null else old.interne_info end;
  v_neu text := case when tg_op = 'DELETE' then null else new.interne_info end;
  v_tour uuid := case when tg_op = 'DELETE' then old.tour_id else new.tour_id end;
begin
  if nullif(btrim(coalesce(v_alt, '')), '') is distinct from nullif(btrim(coalesce(v_neu, '')), '')
     and exists (select 1 from touren where id = v_tour) then
    insert into tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
    values (v_tour, auth.uid(), 'interne_info', v_alt, v_neu, 'intern', now(), auth.uid());
  end if;
  return null;
end;
$$;
drop trigger if exists touren_admin_info_protokoll on public.touren_admin_info;
create trigger touren_admin_info_protokoll
  after insert or update or delete on public.touren_admin_info
  for each row execute function public.touren_admin_info_protokoll();

-- ---- Zeilen-Hilfen (Zeile = durch Zeilenumbruch getrennt)
create or replace function public.info_zeile_index(p_text text, p_zeile text)
returns int language sql immutable as $$
  select array_position(string_to_array(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\n'), p_zeile);
$$;

create or replace function public.info_zeile_setzen(p_text text, p_index int, p_neu text)
returns text language plpgsql immutable as $$
declare
  v text[] := string_to_array(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\n');
  v_out text;
begin
  if p_neu is null then
    v := v[1:p_index - 1] || v[p_index + 1:];
  else
    v[p_index] := p_neu;
  end if;
  v_out := array_to_string(v, E'\n');
  return nullif(btrim(v_out, E' \n'), '');
end;
$$;

-- ---- Leerfahrt mit Grund (setzen, Grund ändern, entfernen)
create or replace function public.tour_leerfahrt_mit_grund(
  p_tour_id uuid, p_an boolean, p_grund text default null, p_text text default null, p_zeile text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_info     touren_admin_info%rowtype;
  v_basis    jsonb;
  v_idx      int;
  v_text     text;
  v_manuell  boolean := false;
  v_zeile    text;
  v_war      boolean;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: „Leerfahrt" darf nur ein Admin setzen.' using errcode = '42501';
  end if;
  if not exists (select 1 from touren where id = p_tour_id) then raise exception 'Tour nicht gefunden'; end if;
  p_text := nullif(btrim(coalesce(p_text, '')), '');
  p_zeile := nullif(btrim(coalesce(p_zeile, '')), '');
  if p_an then
    if p_grund is null or p_grund !~ '^[a-z_]{1,40}$' then
      raise exception 'GRUND_FEHLT: Bitte einen Grund für die Leerfahrt auswählen.' using errcode = '23514';
    end if;
    if p_grund = 'sonstiges' and p_text is null then
      raise exception 'GRUND_TEXT_FEHLT: Bei „Sonstiges" bitte den Grund eintragen.' using errcode = '23514';
    end if;
    if p_zeile is null or position(E'\n' in p_zeile) > 0 then
      raise exception 'ZEILE_UNGUELTIG: Eintrag für die interne Info fehlt.' using errcode = '23514';
    end if;
  end if;

  v_war := exists (select 1 from tour_leerfahrt where tour_id = p_tour_id);
  v_basis := public.tour_leerfahrt_setzen(p_tour_id, p_an);

  insert into touren_admin_info (tour_id) values (p_tour_id) on conflict (tour_id) do nothing;
  select * into v_info from touren_admin_info where tour_id = p_tour_id for update;
  v_text := v_info.interne_info;
  v_idx := case when v_info.leerfahrt_zeile is null then null else public.info_zeile_index(v_text, v_info.leerfahrt_zeile) end;

  if p_an then
    if v_info.leerfahrt_zeile is not null and v_idx is not null then
      v_text := public.info_zeile_setzen(v_text, v_idx, p_zeile);      -- vom System geschriebene Zeile ersetzen
      v_zeile := p_zeile;
    elsif v_info.leerfahrt_zeile is not null then
      v_manuell := true;                                                -- von Hand geändert: nicht anfassen
      v_zeile := v_info.leerfahrt_zeile;                                -- Referenz behalten (Hinweis auch beim Entfernen)
    else
      v_text := case when nullif(btrim(coalesce(v_text, ''), E' \n'), '') is null then p_zeile
                     else rtrim(v_text, E' \n') || E'\n' || p_zeile end; -- anhängen, nie überschreiben
      v_zeile := p_zeile;
    end if;
    update touren_admin_info
       set interne_info = v_text, leerfahrt_grund = p_grund, leerfahrt_text = p_text, leerfahrt_zeile = v_zeile
     where tour_id = p_tour_id;
    if v_war and v_info.leerfahrt_grund is distinct from p_grund or v_war and v_info.leerfahrt_text is distinct from p_text then
      perform leerfahrt_protokoll(p_tour_id, v_info.leerfahrt_zeile, 'Grund geändert: ' || p_zeile);
    elsif not v_war then
      perform leerfahrt_protokoll(p_tour_id, null, 'Grund: ' || p_zeile);
    end if;
  else
    if v_info.leerfahrt_zeile is not null and v_idx is not null then
      v_text := public.info_zeile_setzen(v_text, v_idx, null);         -- Zeile entfernen
    elsif v_info.leerfahrt_zeile is not null then
      v_manuell := true;
    end if;
    update touren_admin_info
       set interne_info = v_text, leerfahrt_grund = null, leerfahrt_text = null, leerfahrt_zeile = null
     where tour_id = p_tour_id;
  end if;

  return v_basis || jsonb_build_object('info_manuell', v_manuell, 'interne_info', v_text, 'neu_markiert', p_an and not v_war);
end;
$$;
revoke all on function public.tour_leerfahrt_mit_grund(uuid, boolean, text, text, text) from public;
grant execute on function public.tour_leerfahrt_mit_grund(uuid, boolean, text, text, text) to authenticated;

-- ---- Tour-Split (106): interne Info + Grund auf die neue Tour übernehmen
create or replace function public.admin_info_bei_aufteilung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.neue_tour_id is not null then
    insert into touren_admin_info (tour_id, interne_info, leerfahrt_grund, leerfahrt_text, leerfahrt_zeile)
    select new.neue_tour_id, i.interne_info, i.leerfahrt_grund, i.leerfahrt_text, i.leerfahrt_zeile
      from touren_admin_info i where i.tour_id = new.tour_id
    on conflict (tour_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists admin_info_aufteilung on public.tour_aufteilungen;
create trigger admin_info_aufteilung
  after insert on public.tour_aufteilungen
  for each row execute function public.admin_info_bei_aufteilung();

notify pgrst, 'reload schema';
