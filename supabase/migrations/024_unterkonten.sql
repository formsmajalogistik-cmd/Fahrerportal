-- ============================================================
-- Maja-Logistik Business-Portal — 024: Unterkonten (Sub-Accounts)
-- ------------------------------------------------------------
-- Ein Auth-User kann mehrere Fahrer-Einträge haben — einen "Haupt"-
-- Eintrag und beliebig viele "Unterkonten". Alle teilen sich denselben
-- Login (auth.users), erscheinen aber als eigenständige Fahrer in der
-- App (eigene Touren, Formulare, Greimel-Zugänge).
-- ============================================================

-- ------------------------------------------------------------
-- Schema-Erweiterung fahrer
-- ------------------------------------------------------------
-- Mehrere fahrer pro user_id sind jetzt erlaubt.
alter table public.fahrer
  drop constraint if exists fahrer_user_id_key;

-- Pro Sub-Account ein eigener Anzeige-Name (Vor-/Nachname).
-- Haupt-Account behält den Namen aus app_users; eigene Werte hier
-- überschreiben das nur, wenn gesetzt.
alter table public.fahrer
  add column if not exists vorname  text,
  add column if not exists nachname text,
  add column if not exists haupt_user_id uuid,
  add column if not exists ist_unterkonto boolean not null default false;

-- FK auf den Haupt-Fahrer (selbe Tabelle). Beim Löschen des Haupt-
-- Eintrags werden Unterkonten kaskadierend entfernt.
alter table public.fahrer
  drop constraint if exists fahrer_haupt_user_id_fkey;
alter table public.fahrer
  add constraint fahrer_haupt_user_id_fkey
  foreign key (haupt_user_id) references public.fahrer(id) on delete cascade;

create index if not exists idx_fahrer_haupt_user_id
  on public.fahrer(haupt_user_id);
create index if not exists idx_fahrer_user_id
  on public.fahrer(user_id);

-- Konsistenz: Unterkonten haben haupt_user_id, Haupt-Konten nicht.
alter table public.fahrer
  drop constraint if exists fahrer_unterkonto_consistent;
alter table public.fahrer
  add constraint fahrer_unterkonto_consistent check (
    (ist_unterkonto = true  and haupt_user_id is not null)
    or
    (ist_unterkonto = false and haupt_user_id is null)
  );

-- ------------------------------------------------------------
-- Helper-Funktion: liefert true, wenn fahrer_id zum aktuellen Auth-
-- User gehört (eigener Eintrag ODER Unterkonto eines eigenen Haupt-
-- Eintrags). Wird in mehreren RLS-Policies genutzt.
-- ------------------------------------------------------------
create or replace function public.fahrer_belongs_to_me(p_fahrer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.fahrer me
    where me.user_id = auth.uid()
      and (
        me.id = p_fahrer_id
        or me.id = (
          select haupt_user_id from public.fahrer where id = p_fahrer_id
        )
      )
  );
$$;

grant execute on function public.fahrer_belongs_to_me(uuid) to authenticated;

-- ------------------------------------------------------------
-- RLS fahrer: User darf alle eigenen Einträge + Unterkonten lesen.
-- ------------------------------------------------------------
drop policy if exists fahrer_self_read on public.fahrer;
create policy fahrer_self_read on public.fahrer
  for select using (
    public.is_admin()
    or user_id = auth.uid()
  );

-- Haupt-User darf eigene Unterkonten INSERT / UPDATE / DELETE.
-- (Admin behält volles Recht via fahrer_admin_write.)
drop policy if exists fahrer_self_unterkonto_write on public.fahrer;
create policy fahrer_self_unterkonto_write on public.fahrer
  for all
  using (
    public.is_admin()
    or (
      ist_unterkonto = true
      and exists (
        select 1 from public.fahrer h
        where h.id = fahrer.haupt_user_id
          and h.user_id = auth.uid()
          and h.ist_unterkonto = false
      )
    )
  )
  with check (
    public.is_admin()
    or (
      ist_unterkonto = true
      and exists (
        select 1 from public.fahrer h
        where h.id = fahrer.haupt_user_id
          and h.user_id = auth.uid()
          and h.ist_unterkonto = false
      )
    )
  );

-- ------------------------------------------------------------
-- RLS touren: Fahrer-Lesen erweitern auf eigene + Unterkonto-Touren.
-- ------------------------------------------------------------
drop policy if exists touren_read on public.touren;
create policy touren_read on public.touren
  for select using (
    public.is_admin()
    or public.fahrer_belongs_to_me(touren.fahrer_id)
  );

-- Haupt-User darf das Feld fahrer_id auf seinen Touren ODER auf
-- Touren seiner Unterkonten ändern — und nur zu einem eigenen
-- Unterkonto / sich selbst zuweisen.
drop policy if exists touren_self_reassign on public.touren;
create policy touren_self_reassign on public.touren
  for update
  using (
    public.is_admin()
    or public.fahrer_belongs_to_me(touren.fahrer_id)
  )
  with check (
    public.is_admin()
    or public.fahrer_belongs_to_me(touren.fahrer_id)
  );

-- ------------------------------------------------------------
-- RLS tour_zusaetze: gleiche Logik wie touren_read.
-- ------------------------------------------------------------
drop policy if exists tour_zusaetze_read on public.tour_zusaetze;
create policy tour_zusaetze_read on public.tour_zusaetze
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.touren t
      where t.id = tour_zusaetze.tour_id
        and public.fahrer_belongs_to_me(t.fahrer_id)
    )
  );

-- ------------------------------------------------------------
-- RLS ausgefuellte_formulare: erweitern auf Unterkonten.
-- ------------------------------------------------------------
drop policy if exists af_self_read on public.ausgefuellte_formulare;
create policy af_self_read on public.ausgefuellte_formulare
  for select using (
    public.is_admin()
    or public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
  );

drop policy if exists af_self_insert on public.ausgefuellte_formulare;
create policy af_self_insert on public.ausgefuellte_formulare
  for insert with check (
    public.is_admin()
    or public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
  );

drop policy if exists af_self_update on public.ausgefuellte_formulare;
create policy af_self_update on public.ausgefuellte_formulare
  for update using (
    public.is_admin()
    or (
      status = 'draft'
      and public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
    )
  ) with check (
    public.is_admin()
    or public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
  );

-- ------------------------------------------------------------
-- RLS greimel_zugaenge: array-Match weiterhin, aber inkl. Unterkonten.
-- ------------------------------------------------------------
drop policy if exists greimel_read on public.greimel_zugaenge;
create policy greimel_read on public.greimel_zugaenge
  for select using (
    public.is_admin()
    or sichtbar_fuer_alle
    or exists (
      select 1 from public.fahrer me
      where me.user_id = auth.uid()
        and (
          me.id = any(greimel_zugaenge.fahrer_ids)
          or exists (
            select 1 from public.fahrer sub
            where sub.haupt_user_id = me.id
              and sub.id = any(greimel_zugaenge.fahrer_ids)
          )
        )
    )
  );

-- ------------------------------------------------------------
-- RLS templates: tour-verknüpfte Sichtbarkeit auch für Unterkonten.
-- ------------------------------------------------------------
drop policy if exists templates_visible_read on public.formular_templates;
create policy templates_visible_read on public.formular_templates
  for select using (
    public.is_admin()
    or sichtbar = true
    or exists (
      select 1
      from public.touren t
      where t.schriftliches_protokoll_id = formular_templates.id
        and t.protokoll_art = 'schriftlich'
        and public.fahrer_belongs_to_me(t.fahrer_id)
    )
  );
