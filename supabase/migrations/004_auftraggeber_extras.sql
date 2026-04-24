-- ============================================================
-- Maja-Logistik Business-Portal — 004: Auftraggeber-Zusatzfelder
-- ------------------------------------------------------------
-- Erweitert die Tabelle `auftraggeber` um Adresse und zwei E-Mail-Adressen.
-- ============================================================

alter table public.auftraggeber
  add column if not exists strasse text,
  add column if not exists plz     text,
  add column if not exists ort     text,
  add column if not exists email1  text,
  add column if not exists email2  text;
