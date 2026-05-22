-- ============================================================
-- Maja-Logistik Business-Portal — 037: Liste der tatsächlich
-- erzeugten PDFs pro Eingang persistieren.
-- ------------------------------------------------------------
-- Bisher haben die Anhängen-Listen (Eingänge-Card, "E-Mail erneut
-- senden") aus template.pdfs heraus berechnet, welche PDFs für ein
-- Formular existieren MÜSSTEN. Übersprungene Bild-only-Vorlagen
-- ohne Bilder landeten so trotzdem in der Anhängen-Liste, der
-- Server hat sie aus OneDrive nicht ladbar gemacht und brach die
-- Mail mit 503 ab.
--
-- Mit pdf_paths halten wir genau die Pfade fest, die nach einer
-- erfolgreichen Generierung wirklich in OneDrive liegen.
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists pdf_paths jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
