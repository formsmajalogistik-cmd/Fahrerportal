-- ============================================================
-- Maja-Logistik Business-Portal — 011: Sondervergütungen pro Auftraggeber
-- ------------------------------------------------------------
-- Pro Auftraggeber kann eine Liste von Sondervergütungen hinterlegt werden,
-- z.B. "Reifenhandling", "Rote Kennzeichen", "Wartezeit".
-- ============================================================

create table if not exists public.sonderverguetungen (
  id               uuid primary key default gen_random_uuid(),
  auftraggeber_id  uuid not null references public.auftraggeber(id) on delete cascade,
  bezeichnung      text not null,
  preis            decimal(10,2) not null default 0,
  einheit          text not null,
  created_at       timestamptz not null default now(),
  unique (auftraggeber_id, bezeichnung)
);

create index if not exists idx_sonderverguetungen_auftraggeber
  on public.sonderverguetungen(auftraggeber_id);

-- ------------------------------------------------------------
-- RLS: Admins voller CRUD-Zugriff, Fahrer nur SELECT
-- ------------------------------------------------------------
alter table public.sonderverguetungen enable row level security;

drop policy if exists sonderverguetungen_read on public.sonderverguetungen;
create policy sonderverguetungen_read on public.sonderverguetungen
  for select using (auth.role() = 'authenticated');

drop policy if exists sonderverguetungen_admin_write on public.sonderverguetungen;
create policy sonderverguetungen_admin_write on public.sonderverguetungen
  for all using (public.is_admin()) with check (public.is_admin());
