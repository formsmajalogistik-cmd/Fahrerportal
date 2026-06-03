-- ============================================================
-- Maja-Logistik Business-Portal — 046: Dezimale Anzahl bei
-- Tour-Zusätzen.
-- ------------------------------------------------------------
-- In der Praxis kommen halbe (oder kleinere) Einheiten vor —
-- z.B. 2,5 Wartezeiten à 10 €. Die alte integer-Spalte mit
-- Check >= 1 wird durch decimal(10,2) mit Check >= 0.01 ersetzt;
-- bestehende Werte werden 1:1 hochcastet (alle waren integer,
-- damit verlustfrei).
-- ============================================================

alter table public.tour_zusaetze
  drop constraint if exists tour_zusaetze_anzahl_check;

alter table public.tour_zusaetze
  alter column anzahl type decimal(10,2) using anzahl::decimal(10,2);

alter table public.tour_zusaetze
  alter column anzahl set default 1;

alter table public.tour_zusaetze
  add constraint tour_zusaetze_anzahl_check check (anzahl >= 0.01);

notify pgrst, 'reload schema';
