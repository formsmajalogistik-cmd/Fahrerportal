-- ============================================================
-- Maja-Logistik Business-Portal — 007: Damage-Diagram-Bucket
-- ------------------------------------------------------------
-- Bucket für Hintergrund-Bilder von Schadendiagrammen (z.B. Fahrzeugskizzen),
-- die der Admin pro Template hochlädt. Lese-Zugriff für alle authentifizierten
-- User, Schreibzugriff nur für Admins.
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('damage-diagrams', 'damage-diagrams', false)
  on conflict (id) do nothing;

drop policy if exists damage_diagrams_admin_write on storage.objects;
create policy damage_diagrams_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'damage-diagrams' and public.is_admin())
  with check (bucket_id = 'damage-diagrams' and public.is_admin());

drop policy if exists damage_diagrams_read on storage.objects;
create policy damage_diagrams_read on storage.objects
  for select to authenticated
  using (bucket_id = 'damage-diagrams');
