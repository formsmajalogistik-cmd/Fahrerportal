-- ============================================================
-- Maja-Logistik Business-Portal — 033: Härtere Variante von
-- expand_fahrer_with_subaccounts.
-- ------------------------------------------------------------
-- Wenn keine zusätzlichen Unterkonten gefunden werden ODER
-- array_agg NULL liefert, gibt die Funktion mindestens die
-- Eingangs-IDs zurück. Damit kann das Frontend sich darauf
-- verlassen, dass die Rückgabe niemals leer ist (sofern p_ids
-- nicht leer war) und kann die Aufstellung wie erwartet bauen.
-- ============================================================

create or replace function public.expand_fahrer_with_subaccounts(p_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result uuid[];
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return array[]::uuid[];
  end if;
  select array_agg(distinct id) into result from (
    -- Eingangs-IDs selbst
    select unnest(p_ids) as id
    union
    -- Plus alle Unterkonten, deren haupt_user_id in der Eingangsliste ist
    select f.id from public.fahrer f where f.haupt_user_id = any(p_ids)
  ) x;
  return coalesce(result, p_ids);
end;
$$;

grant execute on function public.expand_fahrer_with_subaccounts(uuid[]) to authenticated;
