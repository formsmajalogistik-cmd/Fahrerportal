-- ============================================================
-- Maja-Logistik Business-Portal — 005: Mehrere PDFs pro Template
-- ------------------------------------------------------------
-- Vorher: ein pdf_template (text) + ein field_mapping (jsonb)
-- Nachher: ein Array `pdfs` mit bis zu 3 Einträgen, jeder mit
--          eigenem name, path und field_mapping.
--
-- Format eines Eintrags:
--   {
--     "id": "protokoll",
--     "name": "Protokoll",
--     "path": "<template_id>/protokoll.pdf"  | null,
--     "field_mapping": { ... }
--   }
-- ============================================================

alter table public.formular_templates
  add column if not exists pdfs jsonb not null default '[]'::jsonb;

-- Backfill: aus den Altspalten einen Eintrag bauen, wenn pdfs noch leer ist
update public.formular_templates t
   set pdfs = jsonb_build_array(
     jsonb_build_object(
       'id',            'protokoll',
       'name',          'Protokoll',
       'path',           t.pdf_template,
       'field_mapping',  coalesce(t.field_mapping, '{}'::jsonb)
     )
   )
 where t.pdfs = '[]'::jsonb
   and (t.pdf_template is not null or coalesce(t.field_mapping, '{}'::jsonb) <> '{}'::jsonb);

-- Alte Spalten entfernen
alter table public.formular_templates drop column if exists pdf_template;
alter table public.formular_templates drop column if exists field_mapping;
