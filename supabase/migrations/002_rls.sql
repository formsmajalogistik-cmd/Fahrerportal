-- ============================================================
-- Maja-Logistik Business-Portal — 002: Row Level Security
-- ------------------------------------------------------------
-- Kernregel: Fahrer sehen nur eigene Daten, Admins sehen alles.
-- ============================================================

alter table public.app_users              enable row level security;
alter table public.auftraggeber           enable row level security;
alter table public.fahrer                 enable row level security;
alter table public.formular_templates     enable row level security;
alter table public.formular_zuweisungen   enable row level security;
alter table public.ausgefuellte_formulare enable row level security;

-- ------------------------------------------------------------
-- app_users
-- Jeder darf sein eigenes Profil lesen. Admins dürfen alles.
-- ------------------------------------------------------------
drop policy if exists app_users_self_read on public.app_users;
create policy app_users_self_read on public.app_users
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists app_users_admin_write on public.app_users;
create policy app_users_admin_write on public.app_users
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- auftraggeber — Lesen für alle angemeldeten; Schreiben nur Admin
-- ------------------------------------------------------------
drop policy if exists auftraggeber_read on public.auftraggeber;
create policy auftraggeber_read on public.auftraggeber
  for select using (auth.role() = 'authenticated');

drop policy if exists auftraggeber_admin_write on public.auftraggeber;
create policy auftraggeber_admin_write on public.auftraggeber
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- fahrer
-- ------------------------------------------------------------
drop policy if exists fahrer_self_read on public.fahrer;
create policy fahrer_self_read on public.fahrer
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists fahrer_admin_write on public.fahrer;
create policy fahrer_admin_write on public.fahrer
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- formular_templates
-- Fahrer lesen nur zugewiesene Templates; Admin: alles.
-- ------------------------------------------------------------
drop policy if exists templates_assigned_read on public.formular_templates;
create policy templates_assigned_read on public.formular_templates
  for select using (
    public.is_admin()
    or exists (
      select 1
      from public.formular_zuweisungen z
      join public.fahrer f on f.id = z.fahrer_id
      where z.template_id = formular_templates.id
        and f.user_id = auth.uid()
    )
  );

drop policy if exists templates_admin_write on public.formular_templates;
create policy templates_admin_write on public.formular_templates
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- formular_zuweisungen
-- ------------------------------------------------------------
drop policy if exists zuweisungen_self_read on public.formular_zuweisungen;
create policy zuweisungen_self_read on public.formular_zuweisungen
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.fahrer f
      where f.id = formular_zuweisungen.fahrer_id and f.user_id = auth.uid()
    )
  );

drop policy if exists zuweisungen_admin_write on public.formular_zuweisungen;
create policy zuweisungen_admin_write on public.formular_zuweisungen
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- ausgefuellte_formulare
-- Fahrer darf eigene lesen, anlegen und Drafts bearbeiten.
-- Einmal submitted → nur noch Admin.
-- ------------------------------------------------------------
drop policy if exists af_self_read on public.ausgefuellte_formulare;
create policy af_self_read on public.ausgefuellte_formulare
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.fahrer f
      where f.id = ausgefuellte_formulare.fahrer_id and f.user_id = auth.uid()
    )
  );

drop policy if exists af_self_insert on public.ausgefuellte_formulare;
create policy af_self_insert on public.ausgefuellte_formulare
  for insert with check (
    public.is_admin()
    or exists (
      select 1 from public.fahrer f
      where f.id = ausgefuellte_formulare.fahrer_id and f.user_id = auth.uid()
    )
  );

drop policy if exists af_self_update on public.ausgefuellte_formulare;
create policy af_self_update on public.ausgefuellte_formulare
  for update using (
    public.is_admin()
    or (
      status = 'draft'
      and exists (
        select 1 from public.fahrer f
        where f.id = ausgefuellte_formulare.fahrer_id and f.user_id = auth.uid()
      )
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.fahrer f
      where f.id = ausgefuellte_formulare.fahrer_id and f.user_id = auth.uid()
    )
  );

drop policy if exists af_admin_delete on public.ausgefuellte_formulare;
create policy af_admin_delete on public.ausgefuellte_formulare
  for delete using (public.is_admin());
