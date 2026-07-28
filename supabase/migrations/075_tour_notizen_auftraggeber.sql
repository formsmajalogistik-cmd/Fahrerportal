-- ============================================================
-- Maja-Logistik Business-Portal — 075: Interne Auftraggeber-Notizen
-- ------------------------------------------------------------
-- Auftraggeber-Profile sollen zu ihren Touren eine interne Notiz
-- erfassen können, die AUSSCHLIESSLICH Konten desselben Auftraggebers
-- sehen — NICHT Admin, NICHT Fahrer, NICHT Test-Profile.
--
-- Bewusst eine SEPARATE Tabelle statt einer Spalte auf touren:
--   * eine Spalte würde in jedem Admin-`select *` auf touren landen,
--   * RLS ist row-, nicht column-level — Spaltenschutz wäre nicht
--     durchsetzbar (siehe H-1 in Migration 063).
--
-- WICHTIG: Für diese Tabelle wird BEWUSST keine Admin-Policy und keine
-- `*_test_read`-Policy angelegt. RLS ist default-deny — ohne passende
-- Policy liefert die Tabelle für Admin/Fahrer/Test schlicht nichts.
-- (Voraussetzung: kein BYPASSRLS auf der App-Rolle. Der anon/authenticated
-- -Key von Supabase hat das nicht; nur der Service-Role-Key umgeht RLS —
-- der wird im Frontend nicht verwendet.)
--
-- Idempotent.
-- ============================================================

create table if not exists public.tour_notizen_auftraggeber (
  id              uuid primary key default gen_random_uuid(),
  tour_id         uuid not null references public.touren(id) on delete cascade,
  auftraggeber_id uuid not null references public.auftraggeber(id) on delete cascade,
  notiz           text,
  erstellt_von    uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tour_id)   -- eine Notiz pro Tour (bearbeitbar)
);

create index if not exists idx_tna_auftraggeber
  on public.tour_notizen_auftraggeber(auftraggeber_id);

comment on table public.tour_notizen_auftraggeber is
  'Interne Notizen der Auftraggeber pro Tour. NUR für Konten desselben '
  'Auftraggebers lesbar — bewusst KEINE Admin-/Test-Policy.';

alter table public.tour_notizen_auftraggeber enable row level security;

-- ------------------------------------------------------------
-- Hilfsfunktion: gehört die Tour zum Auftraggeber des Aufrufers?
-- SECURITY DEFINER, weil Auftraggeber seit H-1 (063) keinen direkten
-- SELECT auf touren haben — die Policy könnte die Zugehörigkeit sonst
-- nicht prüfen.
-- ------------------------------------------------------------
create or replace function public.tour_ist_von_meinem_ag(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.touren t
    where t.id = p_tour_id
      and t.auftraggeber_id is not null
      and t.auftraggeber_id = public.current_auftraggeber_id()
  );
$$;

revoke all on function public.tour_ist_von_meinem_ag(uuid) from public;
grant execute on function public.tour_ist_von_meinem_ag(uuid) to authenticated;

-- ------------------------------------------------------------
-- Policies: ausschließlich Rolle 'auftraggeber' mit passender
-- auftraggeber_id. is_auftraggeber() ist true NUR für die echte Rolle
-- 'auftraggeber' — Test-Profile haben role='test' und fallen damit
-- ebenfalls raus.
-- ------------------------------------------------------------

drop policy if exists tna_ag_select on public.tour_notizen_auftraggeber;
create policy tna_ag_select on public.tour_notizen_auftraggeber
  for select using (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
  );

drop policy if exists tna_ag_insert on public.tour_notizen_auftraggeber;
create policy tna_ag_insert on public.tour_notizen_auftraggeber
  for insert with check (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
    -- Zusätzlich: die Tour selbst muss zum eigenen Auftraggeber gehören.
    and public.tour_ist_von_meinem_ag(tour_id)
  );

drop policy if exists tna_ag_update on public.tour_notizen_auftraggeber;
create policy tna_ag_update on public.tour_notizen_auftraggeber
  for update using (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
  ) with check (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
    and public.tour_ist_von_meinem_ag(tour_id)
  );

drop policy if exists tna_ag_delete on public.tour_notizen_auftraggeber;
create policy tna_ag_delete on public.tour_notizen_auftraggeber
  for delete using (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
  );

-- Tabellen-Grants: ohne passende Policy bleibt RLS default-deny.
grant select, insert, update, delete on public.tour_notizen_auftraggeber to authenticated;

-- updated_at pflegen (touch_updated_at existiert seit 012).
drop trigger if exists tna_updated_at on public.tour_notizen_auftraggeber;
create trigger tna_updated_at
  before update on public.tour_notizen_auftraggeber
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';
