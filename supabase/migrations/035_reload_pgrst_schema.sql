-- ============================================================
-- Maja-Logistik Business-Portal — 035: PostgREST-Schema-Cache
-- nach 027 zwingend neu laden.
-- ------------------------------------------------------------
-- 027 hat formular_templates.auftraggeber_id gedroppt. Falls der
-- PostgREST-Schema-Cache auf Supabase aus irgend einem Grund noch
-- die alte FK-Relationship liefert, schlagen Embed-Queries mit
-- "Could not find a relationship between 'formular_templates' and
-- 'auftraggeber_id' in the schema cache" fehl.
--
-- Diese Migration sorgt dafür, dass:
--   1) die Spalte sicher weg ist (idempotent),
--   2) PostgREST den Schema-Cache neu lädt.
-- ============================================================

drop index if exists public.idx_templates_auftraggeber;

alter table public.formular_templates
  drop column if exists auftraggeber_id;

notify pgrst, 'reload schema';
