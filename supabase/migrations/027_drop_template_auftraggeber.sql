-- ============================================================
-- Maja-Logistik Business-Portal — 027: Auftraggeber-Zuweisung
-- von Formular-Templates entfernen.
-- ------------------------------------------------------------
-- Die Auftraggeber-Zuordnung wurde nur für Anzeige/Filter genutzt;
-- die Benennung der Templates reicht. Wir entfernen die Spalte
-- inklusive zugehörigem Index — der FK war ON DELETE SET NULL,
-- also kein Cascade-Risiko.
-- ============================================================

drop index if exists public.idx_templates_auftraggeber;

alter table public.formular_templates
  drop column if exists auftraggeber_id;
