-- ============================================================
-- Maja-Logistik Business-Portal — 036: Zwischenprotokoll-PDF
-- pro begonnenem Formular.
-- ------------------------------------------------------------
-- Admin kann aus einem Draft-Formular (status='draft') eine
-- PDF-Vorschau des aktuellen Standes erzeugen. Pfad und Zeitstempel
-- werden hier gespeichert. Beim finalen Einreichen entfernt der
-- Client die Datei aus OneDrive und nullt beide Spalten.
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists zwischenprotokoll_url text,
  add column if not exists zwischenprotokoll_erstellt_am timestamptz;

notify pgrst, 'reload schema';
