-- ============================================================
-- Maja-Logistik Business-Portal — 016: E-Fahrzeug, FIN, Mehrere Kontakte
-- ------------------------------------------------------------
-- 1. preisstufen.e_fahrzeug_aufschlag (Aufschlag pro Stufe für E-Fahrzeuge)
-- 2. touren.ist_e_fahrzeug, touren.fin, touren.kontakt_id
-- 3. Neue Tabelle auftraggeber_kontakte (mehrere Kontakte pro Auftraggeber)
-- 4. RPC calculate_tour_price erweitert um Parameter p_ist_e_fahrzeug
-- ============================================================

-- ------------------------------------------------------------
-- 1. preisstufen.e_fahrzeug_aufschlag
-- ------------------------------------------------------------
alter table public.preisstufen
  add column if not exists e_fahrzeug_aufschlag decimal(10,2) not null default 0;

-- ------------------------------------------------------------
-- 2. auftraggeber_kontakte (Tabelle vor touren-FK anlegen)
-- ------------------------------------------------------------
create table if not exists public.auftraggeber_kontakte (
  id              uuid primary key default gen_random_uuid(),
  auftraggeber_id uuid not null references public.auftraggeber(id) on delete cascade,
  name            text not null,
  telefon         text,
  email           text,
  position        text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_auftraggeber_kontakte_ag
  on public.auftraggeber_kontakte(auftraggeber_id);

alter table public.auftraggeber_kontakte enable row level security;

drop policy if exists ag_kontakte_read on public.auftraggeber_kontakte;
create policy ag_kontakte_read on public.auftraggeber_kontakte
  for select using (auth.role() = 'authenticated');

drop policy if exists ag_kontakte_admin_write on public.auftraggeber_kontakte;
create policy ag_kontakte_admin_write on public.auftraggeber_kontakte
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 3. touren: ist_e_fahrzeug, fin, kontakt_id
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists ist_e_fahrzeug boolean not null default false,
  add column if not exists fin            text,
  add column if not exists kontakt_id     uuid;

alter table public.touren
  drop constraint if exists touren_kontakt_id_fkey;
alter table public.touren
  add constraint touren_kontakt_id_fkey
  foreign key (kontakt_id)
  references public.auftraggeber_kontakte(id)
  on delete set null;

-- ------------------------------------------------------------
-- 4. RPC erweitert um p_ist_e_fahrzeug
-- Alte 3-arg-Signatur löschen, damit die neue 4-arg-Signatur eindeutig ist.
-- ------------------------------------------------------------
drop function if exists public.calculate_tour_price(uuid, integer, text);

create or replace function public.calculate_tour_price(
  p_auftraggeber_id uuid,
  p_km              integer,
  p_tourenart       text default 'AB',
  p_ist_e_fahrzeug  boolean default false
)
returns decimal
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_preis        decimal;
  v_e_aufschlag  decimal := 0;
  v_aufschlag    decimal;
begin
  if p_auftraggeber_id is null or p_km is null then
    return null;
  end if;

  select preis, coalesce(e_fahrzeug_aufschlag, 0)
    into v_preis, v_e_aufschlag
    from public.preisstufen
   where auftraggeber_id = p_auftraggeber_id
     and p_km >= km_von
     and p_km <= km_bis
   order by km_von
   limit 1;

  if v_preis is null then
    return null;
  end if;

  if p_tourenart = 'ABA' then
    select aba_aufschlag_prozent into v_aufschlag
      from public.auftraggeber
     where id = p_auftraggeber_id;
    if v_aufschlag is not null and v_aufschlag > 0 then
      v_preis := round(v_preis + v_preis * v_aufschlag / 100.0, 2);
    end if;
  end if;

  if p_ist_e_fahrzeug then
    v_preis := v_preis + v_e_aufschlag;
  end if;

  return v_preis;
end;
$$;

grant execute on function public.calculate_tour_price(uuid, integer, text, boolean) to authenticated;
