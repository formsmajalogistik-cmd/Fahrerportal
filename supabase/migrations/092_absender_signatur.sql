-- Migration 092: Unterschrift und Firmenstempel des Absenders
--
-- Bisher hatte das Brief-PDF rechts nur eine leere Unterschriftslinie —
-- unterschrieben werden konnte dort ausschließlich auf Papier. Mit
-- dieser Migration hinterlegt jeder Admin einmalig seine Unterschrift
-- und den Firmenstempel; beim PDF werden beide automatisch eingesetzt.
--
-- Entscheidung „pro Admin oder firmenweit?" (die Vorgabe stellte den
-- Stempel frei): BEIDES pro Admin-Konto, in einer Zeile. Das ist der
-- einfachere Weg — eine Tabelle, eine Policy, ein Bucket-Pfad, eine
-- Oberfläche. Ein firmenweiter Stempel hätte eine zweite Ablage mit
-- eigener Berechtigung gebraucht (wer darf den Firmenstempel ändern?),
-- ohne dass die wenigen Admin-Konten davon spürbar profitieren. Wollen
-- mehrere Admins denselben Stempel, laden sie dasselbe Bild hoch.
--
-- Die Bilder liegen NICHT in der Datenbank, sondern als PNG in einem
-- privaten Bucket; die Tabelle hält nur den Pfad. Gelesen wird
-- ausschließlich über kurzlebige signierte URLs.

-- ------------------------------------------------------------
-- 1. Tabelle — eine Zeile pro Admin
-- ------------------------------------------------------------
create table if not exists public.absender_signaturen (
  user_id           uuid primary key references public.app_users(id) on delete cascade,
  unterschrift_pfad text,
  stempel_pfad      text,
  aktualisiert_am   timestamptz not null default now()
);

comment on table public.absender_signaturen is
  'Unterschrift + Firmenstempel des Absenders, pro Admin-Konto. Werte sind Pfade im privaten Bucket "absender", keine Bilddaten.';

-- ------------------------------------------------------------
-- 2. RLS — nur Admins, und schreiben nur die eigene Zeile
--
--    Lesen dürfen Admins alle Zeilen (sie sehen sonst nicht, ob ein
--    Kollege bereits hinterlegt hat); ändern darf jeder nur seine
--    eigene. Fahrer, Auftraggeber und Test-Konten haben keinen Zugriff
--    — weder auf die Tabelle noch (siehe unten) auf den Bucket.
-- ------------------------------------------------------------
alter table public.absender_signaturen enable row level security;

drop policy if exists absender_sig_admin_read on public.absender_signaturen;
create policy absender_sig_admin_read on public.absender_signaturen
  for select using (public.is_admin());

drop policy if exists absender_sig_self_write on public.absender_signaturen;
create policy absender_sig_self_write on public.absender_signaturen
  for insert with check (public.is_admin() and user_id = auth.uid());

drop policy if exists absender_sig_self_update on public.absender_signaturen;
create policy absender_sig_self_update on public.absender_signaturen
  for update using (public.is_admin() and user_id = auth.uid())
          with check (public.is_admin() and user_id = auth.uid());

drop policy if exists absender_sig_self_delete on public.absender_signaturen;
create policy absender_sig_self_delete on public.absender_signaturen
  for delete using (public.is_admin() and user_id = auth.uid());

grant select, insert, update, delete on public.absender_signaturen to authenticated;

-- ------------------------------------------------------------
-- 3. Privater Storage-Bucket
--
--    Pfad-Konvention: {user_id}/unterschrift.png bzw. {user_id}/stempel.png
--    → (storage.foldername(name))[1] = user_id
--    public = false, es gibt also KEINE öffentliche URL; der Client
--    holt sich pro Anzeige eine kurzlebige signierte URL.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('absender', 'absender', false)
  on conflict (id) do nothing;

-- Lesen: jeder Admin (das Brief-PDF wird vom ausstellenden Admin
-- erzeugt, Vertretungsfälle eingeschlossen).
drop policy if exists absender_storage_read on storage.objects;
create policy absender_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'absender' and public.is_admin());

-- Schreiben/Ersetzen/Löschen: nur im eigenen Ordner.
drop policy if exists absender_storage_insert on storage.objects;
create policy absender_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'absender'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists absender_storage_update on storage.objects;
create policy absender_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'absender'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'absender'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists absender_storage_delete on storage.objects;
create policy absender_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'absender'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------
-- 4. Schalter pro Dokument
--
--    Default true: liegt eine Unterschrift vor, wird sie eingesetzt.
--    Ist nichts hinterlegt, bleibt der Bereich wie bisher leer — der
--    Schalter allein erzeugt nichts. Für Schreiben, die von Hand
--    unterschrieben werden sollen, lässt sich das je Dokument abwählen.
-- ------------------------------------------------------------
alter table public.briefe
  add column if not exists mit_unterschrift boolean not null default true,
  add column if not exists mit_stempel      boolean not null default true;

alter table public.rechnungen
  add column if not exists mit_unterschrift boolean not null default true,
  add column if not exists mit_stempel      boolean not null default true;

alter table public.gutschriften
  add column if not exists mit_unterschrift boolean not null default true,
  add column if not exists mit_stempel      boolean not null default true;

-- Alle drei Tabellen sind Admin-only (040, 078, 091) — die beiden
-- Schalter sind damit ohnehin nur für Admins sichtbar.

notify pgrst, 'reload schema';
