-- ============================================================
-- Maja-Logistik Business-Portal — 010: Preisstufen pro Auftraggeber
-- ------------------------------------------------------------
-- Pro Auftraggeber kann eine Liste von km-Stufen mit Preis hinterlegt werden.
-- Außerdem wird ein optionaler OneDrive-Pfad zur hochgeladenen Preislisten-PDF
-- in der Tabelle `auftraggeber` ergänzt.
-- ============================================================

-- ------------------------------------------------------------
-- auftraggeber: Preislisten-PDF-URL
-- ------------------------------------------------------------
alter table public.auftraggeber
  add column if not exists preisliste_pdf_url text;

-- ------------------------------------------------------------
-- preisstufen
-- ------------------------------------------------------------
create table if not exists public.preisstufen (
  id               uuid primary key default gen_random_uuid(),
  auftraggeber_id  uuid not null references public.auftraggeber(id) on delete cascade,
  km_von           integer not null,
  km_bis           integer not null,
  preis            decimal(10,2) not null default 0,
  created_at       timestamptz not null default now(),
  unique (auftraggeber_id, km_von, km_bis)
);

create index if not exists idx_preisstufen_auftraggeber
  on public.preisstufen(auftraggeber_id);

-- ------------------------------------------------------------
-- RLS: Admins voller CRUD-Zugriff, Fahrer nur SELECT
-- ------------------------------------------------------------
alter table public.preisstufen enable row level security;

drop policy if exists preisstufen_read on public.preisstufen;
create policy preisstufen_read on public.preisstufen
  for select using (auth.role() = 'authenticated');

drop policy if exists preisstufen_admin_write on public.preisstufen;
create policy preisstufen_admin_write on public.preisstufen
  for all using (public.is_admin()) with check (public.is_admin());
