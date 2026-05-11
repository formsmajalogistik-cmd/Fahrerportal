-- ============================================================
-- Maja-Logistik Business-Portal — 020: Kontaktperson pro Adresse
-- ------------------------------------------------------------
-- Statt einer einzigen Kontaktperson "vor Ort" hat jetzt JEDE Adresse
-- (Start / Ziel / Rückführung) ihren eigenen Kontakt. Datenstruktur
-- pro Spalte: { "name": "", "telefon": "", "email": "" } als jsonb.
--
-- Die alten Spalten (kontakt_name, kontakt_telefon, kontakt_email) aus
-- Migration 019 werden entfernt. Bestehende Werte gehen verloren — bis
-- jetzt waren sie nur in wenigen Test-Touren befüllt, daher gehen wir
-- bewusst den einfachen Weg statt eine Datenmigration zu schreiben.
-- ============================================================

alter table public.touren
  add column if not exists kontakt_start         jsonb,
  add column if not exists kontakt_ziel          jsonb,
  add column if not exists kontakt_rueckfuehrung jsonb;

alter table public.touren
  drop column if exists kontakt_name,
  drop column if exists kontakt_telefon,
  drop column if exists kontakt_email;
