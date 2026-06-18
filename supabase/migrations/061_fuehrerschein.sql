-- ============================================================
-- Maja-Logistik Business-Portal — 061: Führerscheinkontrolle
-- ------------------------------------------------------------
-- Regelmäßige Führerschein-Prüfung: Admin startet eine Abfrage-Runde,
-- Fahrer laden Vorder-/Rückseite hoch, Admin sichtet und hakt ab —
-- danach werden die Bilder UNWIDERRUFLICH gelöscht.
--
-- DATENSCHUTZ: Führerschein-Bilder sind sensible personenbezogene
-- Daten. Sie liegen ausschließlich im PRIVATEN Storage-Bucket
-- `fuehrerschein` (nicht öffentlich, RLS-geschützt), NIE in OneDrive
-- und NIE als base64 in der DB. Zugriff nur über kurzlebige signierte
-- URLs: der jeweilige Fahrer (eigener Pfad) und Admins. Nach dem
-- Abhaken löscht der Admin die Objekte; in der DB bleiben nur
-- Prüf-Status + Datum, keine Bildpfade.
--
-- Idempotent. Voraussetzung: is_admin() (001) und
-- fahrer_belongs_to_me() (024).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabellen
-- ------------------------------------------------------------

create table if not exists public.fuehrerschein_abfragen (
  id            uuid primary key default gen_random_uuid(),
  gestartet_von uuid references public.app_users(id) on delete set null,
  gestartet_am  timestamptz not null default now(),
  status        text not null default 'offen' check (status in ('offen', 'abgeschlossen')),
  notiz         text
);

create index if not exists idx_fs_abfragen_status on public.fuehrerschein_abfragen(status);
create index if not exists idx_fs_abfragen_gestartet on public.fuehrerschein_abfragen(gestartet_am desc);

create table if not exists public.fuehrerschein_einreichungen (
  id                    uuid primary key default gen_random_uuid(),
  abfrage_id            uuid not null references public.fuehrerschein_abfragen(id) on delete cascade,
  fahrer_id             uuid not null references public.fahrer(id) on delete cascade,
  name_eingetragen      text,
  bild_vorderseite_pfad text,   -- Storage-Pfad im Bucket fuehrerschein (kein OneDrive!)
  bild_rueckseite_pfad  text,
  eingereicht_am        timestamptz not null default now(),
  geprueft              boolean not null default false,
  geprueft_am           timestamptz,
  geprueft_von          uuid references public.app_users(id) on delete set null,
  unique (abfrage_id, fahrer_id)
);

create index if not exists idx_fs_einr_abfrage on public.fuehrerschein_einreichungen(abfrage_id);
create index if not exists idx_fs_einr_fahrer  on public.fuehrerschein_einreichungen(fahrer_id);

-- ------------------------------------------------------------
-- 2. RLS
-- ------------------------------------------------------------

alter table public.fuehrerschein_abfragen enable row level security;
alter table public.fuehrerschein_einreichungen enable row level security;

-- Abfragen: Admin volle CRUD; alle Authentifizierten dürfen lesen
-- (Fahrer müssen wissen, ob eine offene Abfrage existiert). Eine Abfrage
-- enthält KEINE sensiblen Daten — nur Status/Datum/Notiz.
drop policy if exists fs_abfragen_admin_all on public.fuehrerschein_abfragen;
create policy fs_abfragen_admin_all on public.fuehrerschein_abfragen
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists fs_abfragen_read on public.fuehrerschein_abfragen;
create policy fs_abfragen_read on public.fuehrerschein_abfragen
  for select using (auth.role() = 'authenticated');

-- Einreichungen: Admin volle CRUD; Fahrer dürfen NUR eigene anlegen und
-- lesen (kein Update/Delete — das Abhaken/Löschen macht der Admin).
drop policy if exists fs_einr_admin_all on public.fuehrerschein_einreichungen;
create policy fs_einr_admin_all on public.fuehrerschein_einreichungen
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists fs_einr_fahrer_select on public.fuehrerschein_einreichungen;
create policy fs_einr_fahrer_select on public.fuehrerschein_einreichungen
  for select using (public.fahrer_belongs_to_me(fahrer_id));

drop policy if exists fs_einr_fahrer_insert on public.fuehrerschein_einreichungen;
create policy fs_einr_fahrer_insert on public.fuehrerschein_einreichungen
  for insert with check (public.fahrer_belongs_to_me(fahrer_id));

-- ------------------------------------------------------------
-- 3. Privater Storage-Bucket + RLS
--    Pfad-Konvention: {abfrage_id}/{fahrer_id}/{vorderseite|rueckseite}.jpg
--    → (storage.foldername(name))[2] = fahrer_id
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('fuehrerschein', 'fuehrerschein', false)
  on conflict (id) do nothing;

-- Lesen: Admin alles; Fahrer nur den eigenen (Unterkonto-)Pfad.
drop policy if exists fs_storage_read on storage.objects;
create policy fs_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fuehrerschein'
    and (
      public.is_admin()
      or public.fahrer_belongs_to_me(((storage.foldername(name))[2])::uuid)
    )
  );

-- Hochladen: Fahrer nur in den eigenen Pfad (Admin ebenfalls erlaubt).
drop policy if exists fs_storage_insert on storage.objects;
create policy fs_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fuehrerschein'
    and (
      public.is_admin()
      or public.fahrer_belongs_to_me(((storage.foldername(name))[2])::uuid)
    )
  );

-- Überschreiben (Re-Upload vor dem Absenden): nur eigener Pfad / Admin.
drop policy if exists fs_storage_update on storage.objects;
create policy fs_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fuehrerschein'
    and (
      public.is_admin()
      or public.fahrer_belongs_to_me(((storage.foldername(name))[2])::uuid)
    )
  )
  with check (
    bucket_id = 'fuehrerschein'
    and (
      public.is_admin()
      or public.fahrer_belongs_to_me(((storage.foldername(name))[2])::uuid)
    )
  );

-- Löschen: NUR Admin (nach dem Abhaken).
drop policy if exists fs_storage_admin_delete on storage.objects;
create policy fs_storage_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'fuehrerschein' and public.is_admin());

notify pgrst, 'reload schema';
