-- ============================================================
-- Maja-Logistik Business-Portal — 015: Protokoll-Verknüpfung + Greimel Zugänge
-- ------------------------------------------------------------
-- 1. touren um Protokoll-Felder ergänzen
-- 2. Tabelle greimel_zugaenge mit RLS und GIN-Index auf fahrer_ids
--
-- Hinweis zu Passwörtern:
--   Die Spalte greimel_zugaenge.passwort speichert den Klartext und ist
--   ausschließlich über RLS abgesichert (Admins schreiben/lesen, Fahrer
--   lesen nur die eigenen Zugänge). Diese pragmatische Lösung erlaubt das
--   Copy-to-Clipboard ohne zusätzliche Decryption-Roundtrip. Eine spätere
--   Hardening-Migration kann pgcrypto/AES-Verschlüsselung ergänzen, ohne
--   das Frontend zu ändern (Spalte wird dann via SECURITY-DEFINER-Funktion
--   gelesen).
-- ============================================================

-- ------------------------------------------------------------
-- greimel_zugaenge
-- ------------------------------------------------------------
create table if not exists public.greimel_zugaenge (
  id                  uuid primary key default gen_random_uuid(),
  titel               text not null,
  benutzername        text not null,
  passwort            text not null,
  link                text,
  fahrer_ids          uuid[] not null default '{}',
  sichtbar_fuer_alle  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_greimel_fahrer_ids
  on public.greimel_zugaenge using gin (fahrer_ids);

drop trigger if exists greimel_updated_at on public.greimel_zugaenge;
create trigger greimel_updated_at
  before update on public.greimel_zugaenge
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- touren: Protokoll-Felder
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists protokoll_art text
    check (protokoll_art is null or protokoll_art in ('app', 'schriftlich')),
  add column if not exists schriftliches_protokoll_id uuid
    references public.formular_templates(id) on delete set null,
  add column if not exists greimel_zugang_id uuid;

alter table public.touren
  drop constraint if exists touren_greimel_zugang_id_fkey;
alter table public.touren
  add constraint touren_greimel_zugang_id_fkey
  foreign key (greimel_zugang_id)
  references public.greimel_zugaenge(id)
  on delete set null;

-- ------------------------------------------------------------
-- RLS: greimel_zugaenge
-- Admins voller CRUD; Fahrer lesen nur Einträge in denen ihre
-- fahrer_id im fahrer_ids-Array ist oder sichtbar_fuer_alle=true.
-- ------------------------------------------------------------
alter table public.greimel_zugaenge enable row level security;

drop policy if exists greimel_read on public.greimel_zugaenge;
create policy greimel_read on public.greimel_zugaenge
  for select using (
    public.is_admin()
    or sichtbar_fuer_alle
    or exists (
      select 1 from public.fahrer f
      where f.user_id = auth.uid()
        and f.id = any(greimel_zugaenge.fahrer_ids)
    )
  );

drop policy if exists greimel_admin_write on public.greimel_zugaenge;
create policy greimel_admin_write on public.greimel_zugaenge
  for all using (public.is_admin()) with check (public.is_admin());
