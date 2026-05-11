-- ============================================================
-- Maja-Logistik Business-Portal — 021: Datums-Felder ohne Uhrzeit
-- ------------------------------------------------------------
-- startdatum + enddatum sind jetzt reine Datums-Felder (date statt
-- timestamptz). Bestehende Werte werden auf ihren Datumsanteil
-- gecastet — die Uhrzeit-Komponente entfällt.
-- ============================================================

alter table public.touren
  alter column startdatum type date using (startdatum::date),
  alter column enddatum   type date using (enddatum::date);
