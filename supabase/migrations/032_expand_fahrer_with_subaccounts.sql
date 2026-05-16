-- ============================================================
-- Maja-Logistik Business-Portal — 032: Helper-Function für die
-- Aufstellung — Fahrer-IDs auf ihre Unterkonten erweitern.
-- ------------------------------------------------------------
-- Damit es bei Hauptkonten mit Unterkonten zuverlässig funktioniert
-- (RLS-unabhängig), bekommt der Admin einen kleinen RPC, der zu
-- einer Liste ausgewählter Fahrer-IDs auch ALLE Unterkonten der
-- jeweils enthaltenen Haupt-Einträge zurückgibt.
-- ============================================================

create or replace function public.expand_fahrer_with_subaccounts(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select unnest(p_ids) as id
  )
  select array_agg(distinct id) from (
    -- Eingangs-IDs selbst
    select id from input
    union
    -- Plus alle Unterkonten, deren haupt_user_id in der Eingangsliste ist
    select f.id
      from public.fahrer f
      join input i on i.id = f.haupt_user_id
  ) all_ids;
$$;

grant execute on function public.expand_fahrer_with_subaccounts(uuid[]) to authenticated;
