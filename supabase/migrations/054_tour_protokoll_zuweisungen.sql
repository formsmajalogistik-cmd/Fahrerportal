-- Mehrere Protokoll-Templates pro Tour zuweisbar.
--
-- Vor dieser Migration konnte einer Tour genau ein Template zugeordnet
-- werden (`touren.schriftliches_protokoll_id`). ABA/ABC-Touren brauchen
-- manchmal zwei verschiedene Protokolle (z.B. Greimel für Hin, Arval
-- für Rück) — daher die neue Verknüpfungstabelle.

create table if not exists public.tour_protokoll_zuweisungen (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.touren(id) on delete cascade,
  template_id uuid not null references public.formular_templates(id) on delete restrict,
  vorgefuellte_daten jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tour_id, template_id)
);

create index if not exists tour_protokoll_zuweisungen_tour_id_idx
  on public.tour_protokoll_zuweisungen (tour_id);

-- RLS: gleiche Logik wie touren — Fahrer dürfen die Zuweisungen ihrer
-- (Unterkonto-)Touren lesen, Admins haben volle Rechte.
alter table public.tour_protokoll_zuweisungen enable row level security;

drop policy if exists tpz_read on public.tour_protokoll_zuweisungen;
create policy tpz_read on public.tour_protokoll_zuweisungen
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.touren t
      where t.id = tour_protokoll_zuweisungen.tour_id
        and public.fahrer_belongs_to_me(t.fahrer_id)
    )
  );

drop policy if exists tpz_write on public.tour_protokoll_zuweisungen;
create policy tpz_write on public.tour_protokoll_zuweisungen
  for all using (public.is_admin()) with check (public.is_admin());

-- Bestehende `schriftliches_protokoll_id`-Werte in die neue Tabelle
-- übernehmen. `vorgefuellte_daten` wandert pro Tour mit dem
-- Erst-Protokoll mit (mehr Zuweisungen gab es vorher nicht).
insert into public.tour_protokoll_zuweisungen
  (tour_id, template_id, vorgefuellte_daten, sort_order)
select id, schriftliches_protokoll_id, vorgefuellte_daten, 0
from public.touren
where schriftliches_protokoll_id is not null
on conflict do nothing;
