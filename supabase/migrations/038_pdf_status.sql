-- ============================================================
-- Maja-Logistik Business-Portal — 038: Status der automatischen
-- PDF-Generierung pro Eingang festhalten.
-- ------------------------------------------------------------
-- Bei einzelnen Fahrern (große iPhone-/HEIC-Bilder) bricht die
-- automatische PDF-Generierung nach dem Einreichen ab. Damit der
-- Admin das in der Eingänge-Liste sieht und gezielt nachgenerieren
-- kann, halten wir Status + Fehlertext fest.
--
--   pdf_status: null  = noch nichts versucht / kein PDF-Template
--               'ok'  = automatisch erfolgreich erzeugt
--               'fehlgeschlagen' = Auto-Generierung schlug fehl
--   pdf_fehler: letzte Fehlermeldung (für die Diagnose)
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists pdf_status text,
  add column if not exists pdf_fehler text;

notify pgrst, 'reload schema';
