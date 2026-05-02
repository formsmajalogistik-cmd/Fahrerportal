-- ============================================================
-- Maja-Logistik Business-Portal — 012: Tourenliste
-- ------------------------------------------------------------
-- Tabellen:
--   touren         Eine Tour pro Eintrag, mit Zwischenstopps als JSONB
--   tour_zusaetze  Zusatzpositionen pro Tour (z.B. Maut, Wartezeit)
--
-- Die `tour_id` (z.B. "T-2026-0001") wird beim INSERT automatisch über
-- einen BEFORE-Trigger vergeben (laufende 4-stellige Nummer pro Jahr).
-- ============================================================

-- ------------------------------------------------------------
-- touren
-- ------------------------------------------------------------
create table if not exists public.touren (
  id                          uuid primary key default gen_random_uuid(),
  tour_id                     text unique,
  start_stadt                 text not null,
  ziel_stadt                  text not null,
  zwischenstopps              jsonb not null default '[]'::jsonb,
  km_start_bis_erster_stopp   integer,
  km_letzter_stopp_bis_ziel   integer,
  km_gesamt                   integer,
  auftraggeber_id             uuid references public.auftraggeber(id) on delete set null,
  fahrer_id                   uuid references public.fahrer(id) on delete set null,
  status                      text not null default 'geplant'
                              check (status in ('geplant', 'aktiv', 'abgeschlossen')),
  startdatum                  timestamptz,
  enddatum                    timestamptz,
  verguetung                  decimal(10,2),
  tourenart                   text check (tourenart in ('AB', 'ABC', 'ABA')),
  sondervereinbarung          text,
  kennzeichen                 text[] not null default '{}',
  barauslagen                 decimal(10,2) not null default 0,
  fahrer_honorar              decimal(10,2) not null default 0,
  info                        text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_touren_auftraggeber on public.touren(auftraggeber_id);
create index if not exists idx_touren_fahrer       on public.touren(fahrer_id);
create index if not exists idx_touren_status       on public.touren(status);
create index if not exists idx_touren_startdatum   on public.touren(startdatum);

-- ------------------------------------------------------------
-- updated_at-Trigger
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touren_updated_at on public.touren;
create trigger touren_updated_at
  before update on public.touren
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- tour_id-Generator (Format "T-YYYY-NNNN")
--
-- Der Trigger wird vor dem INSERT ausgeführt und vergibt die nächste
-- laufende 4-stellige Nummer für das Jahr (basierend auf created_at).
-- Wir nutzen eine Advisory-Lock pro Jahr, damit konkurrierende Inserts
-- nicht dieselbe Nummer bekommen.
-- ------------------------------------------------------------
create or replace function public.assign_tour_id()
returns trigger
language plpgsql
as $$
declare
  v_year       int;
  v_next       int;
  v_lock_key   bigint;
begin
  if new.tour_id is not null and new.tour_id <> '' then
    return new;
  end if;
  v_year := extract(year from coalesce(new.created_at, now()))::int;
  -- Eindeutiger 64-bit-Lock-Key pro Jahr (Präfix 84600 = "TOUR")
  v_lock_key := 84600000000 + v_year;
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(
    max(
      nullif(regexp_replace(t.tour_id, '^T-' || v_year || '-', ''), '')::int
    ),
    0
  ) + 1
    into v_next
    from public.touren t
   where t.tour_id like 'T-' || v_year || '-%';

  new.tour_id := 'T-' || v_year || '-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists touren_assign_tour_id on public.touren;
create trigger touren_assign_tour_id
  before insert on public.touren
  for each row execute function public.assign_tour_id();

-- ------------------------------------------------------------
-- RLS: Admin volle CRUD, Fahrer SELECT nur eigene
-- ------------------------------------------------------------
alter table public.touren enable row level security;

drop policy if exists touren_read on public.touren;
create policy touren_read on public.touren
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.fahrer f
      where f.id = touren.fahrer_id and f.user_id = auth.uid()
    )
  );

drop policy if exists touren_admin_write on public.touren;
create policy touren_admin_write on public.touren
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- tour_zusaetze
-- ------------------------------------------------------------
create table if not exists public.tour_zusaetze (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.touren(id) on delete cascade,
  kategorie   text not null,
  betrag      decimal(10,2) not null,
  notiz       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tour_zusaetze_tour on public.tour_zusaetze(tour_id);

alter table public.tour_zusaetze enable row level security;

drop policy if exists tour_zusaetze_read on public.tour_zusaetze;
create policy tour_zusaetze_read on public.tour_zusaetze
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.touren t
      join public.fahrer  f on f.id = t.fahrer_id
      where t.id = tour_zusaetze.tour_id
        and f.user_id = auth.uid()
    )
  );

drop policy if exists tour_zusaetze_admin_write on public.tour_zusaetze;
create policy tour_zusaetze_admin_write on public.tour_zusaetze
  for all using (public.is_admin()) with check (public.is_admin());
