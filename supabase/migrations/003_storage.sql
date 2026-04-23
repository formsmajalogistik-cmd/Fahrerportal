-- ============================================================
-- Maja-Logistik Business-Portal — 003: Storage Buckets
-- ------------------------------------------------------------
--   pdf-templates   Admin legt PDF-Vorlagen ab, alle Authentifizierten lesen
--   formular-fotos  Fahrer speichern Fotos unter <user_id>/...
--   formular-pdfs   Generierte Ausgabe-PDFs unter <user_id>/...
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('pdf-templates', 'pdf-templates', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('formular-fotos', 'formular-fotos', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('formular-pdfs', 'formular-pdfs', false)
  on conflict (id) do nothing;

-- pdf-templates: Admin schreibt, alle Angemeldeten lesen
drop policy if exists pdf_templates_admin_write on storage.objects;
create policy pdf_templates_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'pdf-templates' and public.is_admin())
  with check (bucket_id = 'pdf-templates' and public.is_admin());

drop policy if exists pdf_templates_read on storage.objects;
create policy pdf_templates_read on storage.objects
  for select to authenticated
  using (bucket_id = 'pdf-templates');

-- formular-fotos: Admin alles, Fahrer eigener Ordner <user_id>/...
drop policy if exists fotos_admin_all on storage.objects;
create policy fotos_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'formular-fotos' and public.is_admin())
  with check (bucket_id = 'formular-fotos' and public.is_admin());

drop policy if exists fotos_user_rw on storage.objects;
create policy fotos_user_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'formular-fotos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'formular-fotos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- formular-pdfs: Admin alles, Fahrer liest/schreibt eigene
drop policy if exists pdfs_admin_all on storage.objects;
create policy pdfs_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'formular-pdfs' and public.is_admin())
  with check (bucket_id = 'formular-pdfs' and public.is_admin());

drop policy if exists pdfs_user_rw on storage.objects;
create policy pdfs_user_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'formular-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'formular-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
