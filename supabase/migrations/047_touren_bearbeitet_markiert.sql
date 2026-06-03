-- ============================================================
-- Maja-Logistik Business-Portal — 047: "Bearbeitet"-Markierung auf
-- aktiven Touren.
-- ------------------------------------------------------------
-- Admins markieren in der Tourenliste pro Tag, welche aktiven
-- Touren sie heute schon bearbeitet haben. Statt eines Booleans
-- speichern wir das Datum — die Checkbox ist genau dann an, wenn
-- bearbeitet_markiert_am = aktuelles Datum. Damit braucht es keinen
-- Cron-Reset, weil eine Markierung von gestern morgen automatisch
-- als "nicht heute" interpretiert wird.
-- ============================================================

alter table public.touren
  add column if not exists bearbeitet_markiert_am date;

notify pgrst, 'reload schema';
