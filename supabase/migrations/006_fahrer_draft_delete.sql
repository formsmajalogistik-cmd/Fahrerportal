-- ============================================================
-- Maja-Logistik Business-Portal — 006: Fahrer dürfen eigene Drafts löschen
-- ------------------------------------------------------------
-- Bisher konnten nur Admins ausgefuellte_formulare löschen. Damit Fahrer
-- ihre eigenen begonnenen Protokolle (status = 'draft') auf dem Dashboard
-- entfernen können, erweitern wir die DELETE-Policy entsprechend.
-- Submitted-Protokolle bleiben für Fahrer schreibgeschützt.
-- ============================================================

drop policy if exists af_admin_delete on public.ausgefuellte_formulare;

drop policy if exists af_delete on public.ausgefuellte_formulare;
create policy af_delete on public.ausgefuellte_formulare
  for delete using (
    public.is_admin()
    or (
      status = 'draft'
      and exists (
        select 1 from public.fahrer f
        where f.id = ausgefuellte_formulare.fahrer_id
          and f.user_id = auth.uid()
      )
    )
  );
