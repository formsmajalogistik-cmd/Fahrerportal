-- ============================================================
-- Maja-Logistik Business-Portal — 008: Galerie-Speicher-Präferenz
-- ------------------------------------------------------------
-- Pro User merken, ob aufgenommene Fotos zusätzlich als Datei zum
-- Speichern in der Geräte-Galerie angeboten werden sollen.
-- ============================================================

alter table public.app_users
  add column if not exists save_to_gallery boolean not null default false;
