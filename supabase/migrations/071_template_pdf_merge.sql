-- ============================================================
-- Maja-Logistik Business-Portal — 071: PDFs zu EINER Datei mergen
-- ------------------------------------------------------------
-- Neue Template-Option: die weiterhin EINZELN gepflegten PDF-Vorlagen
-- (eigenes Mapping pro Vorlage) werden bei der Generierung in der
-- Reihenfolge der Vorlagen-Liste zu EINER Gesamt-PDF zusammengeführt.
-- Default: aus → bestehende Templates verhalten sich exakt wie bisher
-- (Einzel-PDFs).
--
-- Die Zwischenprotokoll-Option („nach Abschnitt X") lebt im schema-jsonb
-- (zwischenprotokoll_nach_section) — dafür ist keine Spalte nötig.
--
-- Idempotent.
-- ============================================================

alter table public.formular_templates
  add column if not exists pdfs_zusammenfuehren boolean not null default false;

comment on column public.formular_templates.pdfs_zusammenfuehren is
  'Bei der Generierung alle erzeugten PDF-Vorlagen in Listen-Reihenfolge '
  'zu EINER Gesamt-PDF mergen (Eingänge/E-Mail zeigen dann eine Datei).';

notify pgrst, 'reload schema';
