-- ============================================================
-- Maja-Logistik Business-Portal — 044: USt-Satz pro Position +
-- Rechnungs-PDF-Slot.
-- ------------------------------------------------------------
-- 1) rechnungspositionen.ust_satz: nullable. NULL = Standard-Satz
--    der Rechnung gilt (rechnungen.ust_satz); ein konkreter Wert
--    überschreibt den Satz nur für diese Position. Brutto/USt
--    werden auf dem Frontend pro Satz aufaddiert.
-- 2) Keine weiteren Schema-Änderungen — pdf_url existiert bereits
--    auf rechnungen.
-- ============================================================

alter table public.rechnungspositionen
  add column if not exists ust_satz decimal(5,2);

notify pgrst, 'reload schema';
