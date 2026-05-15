-- ============================================================
-- Maja-Logistik Business-Portal — 030: Externe Protokollierungs-App
-- pro Auftraggeber.
-- ------------------------------------------------------------
-- Manche Auftraggeber protokollieren in ihrer eigenen App
-- (FleetBoard, Carsysteme Portal, …). Wir merken uns Name + URL
-- pro Auftraggeber, damit Fahrer aus dem Tour-Detail mit einem
-- Klick zur richtigen Stelle springen können.
-- ============================================================

alter table public.auftraggeber
  add column if not exists externe_app_name text,
  add column if not exists externe_app_url  text;
