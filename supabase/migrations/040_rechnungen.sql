-- ============================================================
-- Maja-Logistik Business-Portal — 040: Rechnungen + Positionen
-- ------------------------------------------------------------
-- Rechnungsmodul Schritt 1: nur Datenmodell.
-- Rechnungsnummer-Format "Re-{Jahr}/{laufende Nummer}", Trigger
-- vergibt sie analog zu touren.tour_id beim INSERT.
-- ============================================================

-- ------------------------------------------------------------
-- rechnungen
-- ------------------------------------------------------------
create table if not exists public.rechnungen (
  id                    uuid primary key default gen_random_uuid(),
  rechnungsnummer       text not null unique,
  auftraggeber_id       uuid not null references public.auftraggeber(id) on delete restrict,
  rechnungsadresse_id   uuid references public.rechnungsadressen(id) on delete set null,
  datum                 date not null default current_date,
  leistungszeitraum_von date not null,
  leistungszeitraum_bis date not null,
  anrede                text,
  netto_summe           decimal(10,2) not null default 0,
  ust_satz              decimal(5,2) not null default 19,
  ust_betrag            decimal(10,2) not null default 0,
  brutto_summe          decimal(10,2) not null default 0,
  status                text not null default 'entwurf'
    check (status in ('entwurf', 'erstellt', 'versendet', 'bezahlt', 'storniert')),
  bezahlt_am            date,
  pdf_url               text,
  notizen               text,
  ist_auslagen_rechnung boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_rechnungen_auftraggeber on public.rechnungen(auftraggeber_id);
create index if not exists idx_rechnungen_status       on public.rechnungen(status);
create index if not exists idx_rechnungen_datum        on public.rechnungen(datum);

-- updated_at-Trigger (nutzt den bereits existierenden touch_updated_at-Helper).
drop trigger if exists rechnungen_updated_at on public.rechnungen;
create trigger rechnungen_updated_at
  before update on public.rechnungen
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Rechnungsnummer-Generator (Format "Re-YYYY/N", N ohne Padding,
-- analog tour_id-Logik). Advisory-Lock pro Jahr verhindert
-- doppelte Nummern bei parallelen Inserts.
-- ------------------------------------------------------------
create or replace function public.assign_rechnungsnummer()
returns trigger
language plpgsql
as $$
declare
  v_year     int;
  v_next     int;
  v_lock_key bigint;
begin
  if new.rechnungsnummer is not null and new.rechnungsnummer <> '' then
    return new;
  end if;
  v_year := extract(year from coalesce(new.datum, current_date))::int;
  -- Eindeutiger 64-bit-Lock-Key pro Jahr (Präfix 73436 = "RECH").
  v_lock_key := 73436000000 + v_year;
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(
    max(
      nullif(regexp_replace(r.rechnungsnummer, '^Re-' || v_year || '/', ''), '')::int
    ),
    0
  ) + 1
    into v_next
    from public.rechnungen r
   where r.rechnungsnummer like 'Re-' || v_year || '/%';

  new.rechnungsnummer := 'Re-' || v_year || '/' || v_next::text;
  return new;
end;
$$;

drop trigger if exists rechnungen_assign_rechnungsnummer on public.rechnungen;
create trigger rechnungen_assign_rechnungsnummer
  before insert on public.rechnungen
  for each row execute function public.assign_rechnungsnummer();

-- RLS: Admin volles CRUD; nicht-Admin: kein Zugriff (auch read).
alter table public.rechnungen enable row level security;

drop policy if exists rechnungen_admin_all on public.rechnungen;
create policy rechnungen_admin_all on public.rechnungen
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- rechnungspositionen
-- ------------------------------------------------------------
create table if not exists public.rechnungspositionen (
  id            uuid primary key default gen_random_uuid(),
  rechnung_id   uuid not null references public.rechnungen(id) on delete cascade,
  position_nr   integer not null,
  bezeichnung   text not null,
  unterzeilen   text[] not null default '{}',
  menge         decimal(10,2) not null default 1,
  einzelpreis   decimal(10,2) not null,
  gesamtpreis   decimal(10,2) not null,
  tour_id       uuid references public.touren(id) on delete set null,
  zusatz_id     uuid references public.tour_zusaetze(id) on delete set null,
  ist_manuell   boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_rechnungspositionen_rechnung
  on public.rechnungspositionen(rechnung_id);

alter table public.rechnungspositionen enable row level security;

drop policy if exists rechnungspositionen_admin_all on public.rechnungspositionen;
create policy rechnungspositionen_admin_all on public.rechnungspositionen
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
