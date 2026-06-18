-- ============================================================
-- Maja-Logistik Business-Portal — 062: Führerschein-Aufnahmezeit
-- ------------------------------------------------------------
-- Live-Kamera-Aufnahme (Aufgabe 1): Wir speichern pro Bild den im
-- Frontend gesetzten Aufnahmezeitpunkt. HINWEIS: Eine 100%ige
-- „Live"-Garantie ist im Browser technisch nicht möglich; die
-- In-App-Kamera (kein Datei-Dialog) ist aber die robusteste Methode.
--
-- Idempotent.
-- ============================================================

alter table public.fuehrerschein_einreichungen
  add column if not exists vorderseite_aufgenommen_am timestamptz,
  add column if not exists rueckseite_aufgenommen_am  timestamptz;

notify pgrst, 'reload schema';
