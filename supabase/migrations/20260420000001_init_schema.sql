-- ============================================================
-- Maja-Logistik Business-Portal — Initial Schema
-- ============================================================
-- Tabellen:
--   app_users              1:1 zu auth.users, enthält Rolle + Profil
--   auftraggeber           Kunden, für die Protokolle ausgefüllt werden
--   fahrer                 Fahrerstammdaten, verknüpft mit app_users
--   formular_templates     JSON-Templates der Protokolle inkl. field_mapping
--   formular_zuweisungen   Welche Templates sind welchem Fahrer zugeordnet
--   ausgefuellte_formulare Erfasste Protokoll-Daten (draft / submitted)
--   fotos                  Uploads, referenziert ausgefuellte_formulare
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
-- app_users — spiegelt auth.users + Rolle/Profil
-- ------------------------------------------------------------
create table if not exists public.app_users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  full_name    text,
  role         user_role not null default 'fahrer',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Trigger: neue auth.users → app_users-Eintrag (Default: fahrer)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'fahrer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Helper: ist aktueller User Admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- ------------------------------------------------------------
-- Auftraggeber
-- ------------------------------------------------------------
create table if not exists public.auftraggeber (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kuerzel      text unique,
  kontakt      text,
  notizen      text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Fahrer — Stammdaten + Link zu app_users
-- ------------------------------------------------------------
create table if not exists public.fahrer (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references public.app_users(id) on delete set null,
  vorname        text not null,
  nachname       text not null,
  personalnummer text unique,
  telefon        text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Formular-Templates (JSON-driven form engine)
-- ------------------------------------------------------------
-- schema_json: {
--   sections: [{ id, title, fields: [{ id, type, label, required, options?, ... }] }]
-- }
-- field_mapping: { "<field_id>": { page, x, y, width?, height?, fontSize?, align? } }
-- ------------------------------------------------------------
create table if not exists public.formular_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  version          integer not null default 1,
  auftraggeber_id  uuid references public.auftraggeber(id) on delete set null,
  beschreibung     text,
  schema_json      jsonb not null,
  field_mapping    jsonb not null default '{}'::jsonb,
  pdf_template     text,
  is_active        boolean not null default true,
  created_by       uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (name, version)
);

create index if not exists idx_templates_auftraggeber on public.formular_templates(auftraggeber_id);
create index if not exists idx_templates_active on public.formular_templates(is_active);

-- ------------------------------------------------------------
-- Zuweisungen: welches Template ist welchem Fahrer zugeordnet?
-- ------------------------------------------------------------
create table if not exists public.formular_zuweisungen (
  id           uuid primary key default gen_random_uuid(),
  fahrer_id    uuid not null references public.fahrer(id) on delete cascade,
  template_id  uuid not null references public.formular_templates(id) on delete cascade,
  gueltig_ab   date,
  gueltig_bis  date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (fahrer_id, template_id)
);

create index if not exists idx_zuweisungen_fahrer on public.formular_zuweisungen(fahrer_id);
create index if not exists idx_zuweisungen_template on public.formular_zuweisungen(template_id);

-- ------------------------------------------------------------
-- Ausgefüllte Formulare (draft + submitted)
-- ------------------------------------------------------------
create table if not exists public.ausgefuellte_formulare (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.formular_templates(id) on delete restrict,
  fahrer_id      uuid not null references public.fahrer(id) on delete restrict,
  status         formular_status not null default 'draft',
  data_json      jsonb not null default '{}'::jsonb,
  pdf_path       text,
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_af_fahrer on public.ausgefuellte_formulare(fahrer_id);
create index if not exists idx_af_template on public.ausgefuellte_formulare(template_id);
create index if not exists idx_af_status on public.ausgefuellte_formulare(status);

-- ------------------------------------------------------------
-- Fotos
-- ------------------------------------------------------------
create table if not exists public.fotos (
  id                uuid primary key default gen_random_uuid(),
  formular_id       uuid not null references public.ausgefuellte_formulare(id) on delete cascade,
  field_id          text not null,
  storage_path      text not null,
  mime_type         text,
  size_bytes        bigint,
  created_at        timestamptz not null default now()
);

create index if not exists idx_fotos_formular on public.fotos(formular_id);

-- ------------------------------------------------------------
-- updated_at Trigger
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'app_users','auftraggeber','fahrer','formular_templates','ausgefuellte_formulare'
  ])
  loop
    execute format(
      'drop trigger if exists trg_set_updated_at on public.%I;
       create trigger trg_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;
