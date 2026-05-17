-- ============================================================
-- Maja-Logistik Business-Portal — 034: Rechnungsformat pro
-- Auftraggeber + separate Rechnungsadressen
-- ------------------------------------------------------------
-- Verschiedene Auftraggeber brauchen unterschiedliche Rechnungs-
-- darstellungen (Standard, Carsysteme, CC Touren+Auslagen,
-- Fahrauftrag). Das Format wird als JSONB direkt am Auftraggeber
-- gespeichert; Rechnungsempfänger-Adressen kommen in eine eigene
-- Tabelle (ein Auftraggeber kann mehrere Adressen haben).
-- ============================================================

-- ------------------------------------------------------------
-- Auftraggeber erweitern
-- ------------------------------------------------------------
alter table public.auftraggeber
  add column if not exists rechnungsformat   jsonb,
  add column if not exists kundennummer      text,
  add column if not exists sachbearbeiter    text,
  add column if not exists kunden_uid        text,
  add column if not exists zahlungsziel_tage integer;

-- ------------------------------------------------------------
-- rechnungsadressen (1:N pro Auftraggeber)
-- ------------------------------------------------------------
create table if not exists public.rechnungsadressen (
  id               uuid primary key default gen_random_uuid(),
  auftraggeber_id  uuid not null references public.auftraggeber(id) on delete cascade,
  firma            text not null,
  ansprechpartner  text,
  strasse          text,
  plz_ort          text,
  land             text,
  ist_standard     boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists idx_rechnungsadressen_auftraggeber
  on public.rechnungsadressen(auftraggeber_id);

-- ------------------------------------------------------------
-- RLS: Admin volles CRUD, Fahrer dürfen lesen.
-- ------------------------------------------------------------
alter table public.rechnungsadressen enable row level security;

drop policy if exists rechnungsadressen_read on public.rechnungsadressen;
create policy rechnungsadressen_read on public.rechnungsadressen
  for select using (auth.role() = 'authenticated');

drop policy if exists rechnungsadressen_admin_write on public.rechnungsadressen;
create policy rechnungsadressen_admin_write on public.rechnungsadressen
  for all using (public.is_admin()) with check (public.is_admin());
