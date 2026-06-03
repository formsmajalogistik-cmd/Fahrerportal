-- ============================================================
-- Maja-Logistik Business-Portal — 048: Routen-Cache.
-- ------------------------------------------------------------
-- Cache für die Google-Routes-API-Antworten. Origin/Destination
-- werden auf Server-Seite normalisiert (lower-case, getrimmt,
-- Mehrfach-Spaces gemerged) und gemeinsam als unique key
-- gespeichert. So sparen wir API-Calls bei wiederkehrenden
-- Strecken (z.B. Stammkunden mit fester Route).
-- ------------------------------------------------------------
-- Die "routes"-Spalte ist genau das, was /api/calculate-route
-- ans Frontend zurückgibt: Array von { index, distanceKm,
-- durationMinutes, description, label }.
-- ============================================================

create table if not exists public.routen_cache (
  id              uuid primary key default gen_random_uuid(),
  origin_norm     text not null,
  destination_norm text not null,
  routes          jsonb not null,
  created_at      timestamptz not null default now(),
  constraint routen_cache_pair_unique unique (origin_norm, destination_norm)
);

create index if not exists idx_routen_cache_created_at
  on public.routen_cache (created_at);

-- RLS: Admin-only — Fahrer haben mit Routen-Berechnungen nichts zu tun,
-- der Cache ist Adresseninhaltlich nicht sensibel, aber konsistent mit
-- dem restlichen Admin-Flow (Tour-Detail, Eingangs-Link).
alter table public.routen_cache enable row level security;

drop policy if exists routen_cache_admin_all on public.routen_cache;
create policy routen_cache_admin_all on public.routen_cache
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
