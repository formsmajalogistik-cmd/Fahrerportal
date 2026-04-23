-- ============================================================
-- Maja-Logistik Business-Portal — 001: Schema
-- ------------------------------------------------------------
-- Tabellen:
--   app_users              Spiegelt auth.users, enthält Rolle + Name
--   auftraggeber           Kunden der Protokolle
--   fahrer                 Fahrer-Eintrag (1:1 zu app_users), Aktiv-Flag
--   formular_templates     JSON-Templates inkl. PDF-Mapping
--   formular_zuweisungen   Welches Template ist welchem Fahrer zugeordnet
--   ausgefuellte_formulare Erfasste Protokolldaten (draft / submitted)
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'fahrer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type formular_status as enum ('draft', 'submitted');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- app_users — 1:1 zu auth.users + Rolle + Profil
-- ------------------------------------------------------------
create table if not exists public.app_users (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text not null unique,
  role      user_role not null default 'fahrer',
  vorname   text,
  nachname  text
);

-- Trigger: neue auth.users → app_users (Default: fahrer)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, role, vorname, nachname)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'fahrer'),
    new.raw_user_meta_data->>'vorname',
    new.raw_user_meta_data->>'nachname'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Helper: Ist der aktuelle User Admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------
-- auftraggeber
-- ------------------------------------------------------------
create table if not exists public.auftraggeber (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  kontakt  text
);

-- ------------------------------------------------------------
-- fahrer
-- ------------------------------------------------------------
create table if not exists public.fahrer (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null unique references public.app_users(id) on delete cascade,
  aktiv    boolean not null default true
);

-- ------------------------------------------------------------
-- formular_templates (JSON-driven form engine)
-- schema: {
--   sections: [{ id, title, fields: [{ id, type, label, required, options?, ... }] }]
-- }
-- field_mapping: { "<field_id>": { page, x, y, width?, height?, fontSize? } }
-- ------------------------------------------------------------
create table if not exists public.formular_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  auftraggeber_id  uuid references public.auftraggeber(id) on delete set null,
  schema           jsonb not null,
  pdf_template     text,
  field_mapping    jsonb not null default '{}'::jsonb
);

create index if not exists idx_templates_auftraggeber
  on public.formular_templates(auftraggeber_id);

-- ------------------------------------------------------------
-- formular_zuweisungen (Fahrer ↔ Template)
-- ------------------------------------------------------------
create table if not exists public.formular_zuweisungen (
  id           uuid primary key default gen_random_uuid(),
  fahrer_id    uuid not null references public.fahrer(id) on delete cascade,
  template_id  uuid not null references public.formular_templates(id) on delete cascade,
  unique (fahrer_id, template_id)
);

create index if not exists idx_zuweisungen_fahrer
  on public.formular_zuweisungen(fahrer_id);
create index if not exists idx_zuweisungen_template
  on public.formular_zuweisungen(template_id);

-- ------------------------------------------------------------
-- ausgefuellte_formulare (draft / submitted)
-- Foto-Dateien werden in Storage abgelegt; im `daten`-JSON liegt der
-- Storage-Pfad unter dem jeweiligen Feld, z.B.
--   "foto_front": { "storage_path": "<user_id>/<formular_id>/foto_front.jpg" }
-- ------------------------------------------------------------
create table if not exists public.ausgefuellte_formulare (
  id           uuid primary key default gen_random_uuid(),
  fahrer_id    uuid not null references public.fahrer(id) on delete restrict,
  template_id  uuid not null references public.formular_templates(id) on delete restrict,
  daten        jsonb not null default '{}'::jsonb,
  status       formular_status not null default 'draft',
  created_at   timestamptz not null default now()
);

create index if not exists idx_af_fahrer
  on public.ausgefuellte_formulare(fahrer_id);
create index if not exists idx_af_template
  on public.ausgefuellte_formulare(template_id);
create index if not exists idx_af_status
  on public.ausgefuellte_formulare(status);
