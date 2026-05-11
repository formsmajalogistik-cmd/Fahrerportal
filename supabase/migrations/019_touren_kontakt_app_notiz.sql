-- ============================================================
-- Maja-Logistik Business-Portal — 019: Kontakt vor Ort + App-Notiz
-- ------------------------------------------------------------
-- - touren.kontakt_name, kontakt_telefon, kontakt_email: separater
--   Block "Kontaktperson vor Ort" im Detail-Panel. Diese Felder werden
--   beim Verknüpfen eines Eingangs aus dem Formular vorbefüllt, wenn
--   sie noch leer sind.
-- - touren.app_notiz: Freitext, der angezeigt wird wenn protokoll_art
--   = 'app' (ersetzt den bisherigen festen Hinweistext).
-- ============================================================

alter table public.touren
  add column if not exists kontakt_name    text,
  add column if not exists kontakt_telefon text,
  add column if not exists kontakt_email   text,
  add column if not exists app_notiz       text;
