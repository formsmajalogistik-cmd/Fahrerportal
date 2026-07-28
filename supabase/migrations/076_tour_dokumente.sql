-- ============================================================
-- Maja-Logistik Business-Portal — 076: Externe Tour-Dokumente
-- ------------------------------------------------------------
-- Protokolle, die NICHT über die App entstanden sind (eingescanntes
-- Papier-Protokoll, PDF vom Kunden), sollen einer Tour zugeordnet und
-- von Admin, zugehörigem Auftraggeber und dem Fahrer der Tour gelesen
-- werden können.
--
-- Sichtbarkeit analog zur bestehenden Dokument-Logik:
--   * Admin: alles (Upload/Löschen nur hier).
--   * Auftraggeber: Dokumente von Touren SEINES Auftraggebers. Prüfung
--     über tour_ist_von_meinem_ag() (075) — Auftraggeber haben seit H-1
--     keinen direkten SELECT auf touren.
--   * Fahrer: nur Touren des eigenen (Unter-)Kontos.
--   * Test-Profile: read-only wie bei den übrigen Tabellen (059).
--
-- Idempotent.
-- ============================================================

create table if not exists public.tour_dokumente (
  id              uuid primary key default gen_random_uuid(),
  tour_id         uuid not null references public.touren(id) on delete cascade,
  bezeichnung     text,
  onedrive_path   text not null,
  dateiname       text not null,
  content_type    text,
  hochgeladen_von uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_tour_dokumente_tour
  on public.tour_dokumente(tour_id);

comment on table public.tour_dokumente is
  'Extern erstellte Protokolle/Dokumente zu einer Tour (Scan, Kunden-PDF). '
  'Dateien liegen in OneDrive unter Maja-Logistik/Tour-Dokumente/.';

alter table public.tour_dokumente enable row level security;

-- ------------------------------------------------------------
-- Hilfsfunktion: gehört die Tour zum (Unter-)Konto des Fahrers?
-- SECURITY DEFINER, damit die Policy nicht an der touren-RLS hängt.
-- ------------------------------------------------------------
create or replace function public.tour_gehoert_meinem_fahrer(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.touren t
    join public.fahrer f on f.id = t.fahrer_id
    where t.id = p_tour_id
      and (f.user_id = auth.uid() or f.haupt_user_id in (
            select id from public.fahrer where user_id = auth.uid()
          ))
  );
$$;

revoke all on function public.tour_gehoert_meinem_fahrer(uuid) from public;
grant execute on function public.tour_gehoert_meinem_fahrer(uuid) to authenticated;

-- ---- Policies ----------------------------------------------------

drop policy if exists tdok_admin_all on public.tour_dokumente;
create policy tdok_admin_all on public.tour_dokumente
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tdok_auftraggeber_read on public.tour_dokumente;
create policy tdok_auftraggeber_read on public.tour_dokumente
  for select using (
    public.is_auftraggeber()
    and public.tour_ist_von_meinem_ag(tour_id)
  );

drop policy if exists tdok_fahrer_read on public.tour_dokumente;
create policy tdok_fahrer_read on public.tour_dokumente
  for select using (public.tour_gehoert_meinem_fahrer(tour_id));

-- Test-Profile lesen read-only mit (Konvention aus 059).
drop policy if exists tdok_test_read on public.tour_dokumente;
create policy tdok_test_read on public.tour_dokumente
  for select using (public.is_test());

grant select, insert, update, delete on public.tour_dokumente to authenticated;

notify pgrst, 'reload schema';
