-- ============================================================
-- Maja-Logistik Business-Portal — 025: Fix RLS-Rekursion bei
-- Unterkonten-Policies auf der fahrer-Tabelle.
-- ------------------------------------------------------------
-- Die Policy `fahrer_self_unterkonto_write` aus 024 hat in ihrem
-- USING/WITH CHECK eine korrelierte Subquery auf public.fahrer.
-- Weil die Policy als FOR ALL (also auch für SELECT) gilt, löste
-- jeder fahrer-SELECT die Subquery aus, die wiederum die Policy
-- der gleichen Tabelle erneut auswertete → "infinite recursion".
--
-- Fix:
--   1. Die Sub-Konto-Check-Logik wird in SECURITY DEFINER Functions
--      gekapselt — Aufrufe innerhalb von Policies umgehen damit RLS.
--   2. Die FOR ALL-Policy wird durch separate Policies für INSERT,
--      UPDATE und DELETE ersetzt (SELECT wird ausschließlich durch
--      fahrer_self_read entschieden).
--   3. greimel_read ersetzt die inline fahrer-Subquery durch eine
--      SECURITY DEFINER Function (any_of_my_fahrer), um indirekte
--      Rekursion zu vermeiden.
-- ============================================================

-- ------------------------------------------------------------
-- Helper-Functions (SECURITY DEFINER, search_path=public, STABLE)
-- ------------------------------------------------------------

-- True, wenn p_haupt_id ein Haupt-Fahrer-Eintrag ist, der dem
-- aktuellen Auth-User gehört.
create or replace function public.is_my_haupt(p_haupt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fahrer h
    where h.id = p_haupt_id
      and h.user_id = auth.uid()
      and h.ist_unterkonto = false
  );
$$;

grant execute on function public.is_my_haupt(uuid) to authenticated;

-- True, wenn mindestens eine der gegebenen Fahrer-IDs dem aktuellen
-- Auth-User gehört (eigener Eintrag ODER Unterkonto eines eigenen
-- Haupt-Eintrags).
create or replace function public.any_of_my_fahrer(p_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fahrer me
    where me.user_id = auth.uid()
      and (
        me.id = any(p_ids)
        or exists (
          select 1 from public.fahrer sub
          where sub.haupt_user_id = me.id
            and sub.id = any(p_ids)
        )
      )
  );
$$;

grant execute on function public.any_of_my_fahrer(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- fahrer-Policies neu setzen: SELECT bleibt simpel, Write-Policies
-- werden pro Aktion definiert und nutzen die Helper-Function.
-- ------------------------------------------------------------
drop policy if exists fahrer_self_unterkonto_write on public.fahrer;

drop policy if exists fahrer_unterkonto_insert on public.fahrer;
create policy fahrer_unterkonto_insert on public.fahrer
  for insert
  with check (
    public.is_admin()
    or (ist_unterkonto = true and public.is_my_haupt(haupt_user_id))
  );

drop policy if exists fahrer_unterkonto_update on public.fahrer;
create policy fahrer_unterkonto_update on public.fahrer
  for update
  using (
    public.is_admin()
    or (ist_unterkonto = true and public.is_my_haupt(haupt_user_id))
  )
  with check (
    public.is_admin()
    or (ist_unterkonto = true and public.is_my_haupt(haupt_user_id))
  );

drop policy if exists fahrer_unterkonto_delete on public.fahrer;
create policy fahrer_unterkonto_delete on public.fahrer
  for delete
  using (
    public.is_admin()
    or (ist_unterkonto = true and public.is_my_haupt(haupt_user_id))
  );

-- fahrer_self_read und fahrer_admin_write bleiben unverändert
-- (kein Selbst-Verweis, kein Rekursionspfad).

-- ------------------------------------------------------------
-- greimel_read: inline fahrer-Subquery durch SECURITY DEFINER
-- Function ersetzen.
-- ------------------------------------------------------------
drop policy if exists greimel_read on public.greimel_zugaenge;
create policy greimel_read on public.greimel_zugaenge
  for select using (
    public.is_admin()
    or sichtbar_fuer_alle
    or public.any_of_my_fahrer(greimel_zugaenge.fahrer_ids)
  );
