-- ============================================================
-- Maja-Logistik Business-Portal — 022: Anzahl pro Tour-Zusatz
-- ------------------------------------------------------------
-- Pro Zusatz-Eintrag kann jetzt eine Anzahl angegeben werden (z.B.
-- "Ladezeit: 3 × 25,00 €"). Standard ist 1, sodass bestehende
-- Einträge unverändert weiter als "1 × Betrag" gerechnet werden.
-- gesamt = anzahl * betrag wird im Frontend berechnet, NICHT in der
-- DB gespeichert.
-- ============================================================

alter table public.tour_zusaetze
  add column if not exists anzahl integer not null default 1;

alter table public.tour_zusaetze
  drop constraint if exists tour_zusaetze_anzahl_check;
alter table public.tour_zusaetze
  add constraint tour_zusaetze_anzahl_check check (anzahl >= 1);
