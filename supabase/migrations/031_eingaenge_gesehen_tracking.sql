-- ============================================================
-- Maja-Logistik Business-Portal — 031: Eingänge "gesehen"-Tracking
-- ------------------------------------------------------------
-- Eingänge (submitted ausgefuellte_formulare) bekommen ein
-- gesehen_am-Timestamp, das beim Öffnen des Eingänge-Reiters
-- gesetzt wird. NULL = ungesehen → erzeugt das rote Badge in der
-- Navigation.
--
-- Bestehende Einträge werden zum Migrations-Zeitpunkt als gesehen
-- markiert, damit das Badge nicht direkt mit Altlasten startet.
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists gesehen_am timestamptz;

update public.ausgefuellte_formulare
   set gesehen_am = now()
 where gesehen_am is null;
