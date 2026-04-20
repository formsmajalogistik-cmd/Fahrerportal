-- ============================================================
-- Row Level Security
-- Regel: Fahrer sehen nur eigene Daten, Admin sieht alles.
-- ============================================================

alter table public.app_users              enable row level security;
alter table public.auftraggeber           enable row level security;
alter table public.fahrer                 enable row level security;
alter table public.formular_templates     enable row level security;
alter table public.formular_zuweisungen   enable row level security;
alter table public.ausgefuellte_formulare enable row level security;
alter table public.fotos                  enable row level security;

-- ------------------------------------------------------------
-- app_users
-- ------------------------------------------------------------
drop policy if exists app_users_self_read on public.app_users;
create policy app_users_self_read on public.app_users
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists app_users_self_update on public.app_users;
create policy app_users_self_update on public.app_users
  for update using (id = auth.uid() or public.is_admin())
  with check (
    -- Fahrer dürfen Rolle/Active nicht an sich selbst ändern
    (public.is_admin())
    or (id = auth.uid()
        and role = (select role from public.app_users where id = auth.uid())
        and is_active = (select is_active from public.app_users where id = auth.uid()))
  );

drop policy if exists app_users_admin_all on public.app_users;
create policy app_users_admin_all on public.app_users
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- auftraggeber — read all (Fahrer brauchen Name im UI), write admin
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
-- Fahrer lesen nur Templates, die ihnen zugewiesen sind.
-- Admin Vollzugriff.
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
        and z.is_active
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
-- Fahrer: nur eigene (CRUD auf eigenen Drafts). Admin: alles.
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

-- Fahrer darf eigene Drafts ändern; einmal submitted → nur Admin
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

-- ------------------------------------------------------------
-- fotos
-- ------------------------------------------------------------
drop policy if exists fotos_read on public.fotos;
create policy fotos_read on public.fotos
  for select using (
    public.is_admin()
    or exists (
      select 1
      from public.ausgefuellte_formulare af
      join public.fahrer f on f.id = af.fahrer_id
      where af.id = fotos.formular_id and f.user_id = auth.uid()
    )
  );

drop policy if exists fotos_insert on public.fotos;
create policy fotos_insert on public.fotos
  for insert with check (
    public.is_admin()
    or exists (
      select 1
      from public.ausgefuellte_formulare af
      join public.fahrer f on f.id = af.fahrer_id
      where af.id = fotos.formular_id and f.user_id = auth.uid()
    )
  );

drop policy if exists fotos_delete on public.fotos;
create policy fotos_delete on public.fotos
  for delete using (
    public.is_admin()
    or exists (
      select 1
      from public.ausgefuellte_formulare af
      join public.fahrer f on f.id = af.fahrer_id
      where af.id = fotos.formular_id
        and af.status = 'draft'
        and f.user_id = auth.uid()
    )
  );
