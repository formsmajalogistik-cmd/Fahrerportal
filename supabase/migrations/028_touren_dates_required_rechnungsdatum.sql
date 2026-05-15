-- ============================================================
-- Maja-Logistik Business-Portal — 028: Pflichtfeld-Daten,
-- Rechnungsdatum, Zusätze nur für Admins lesbar
-- ============================================================

-- ------------------------------------------------------------
-- 1. NOT-NULL-Datumsfelder. Bestehende NULL-Werte werden auf
--    den 01.01.2023 gesetzt — weit genug in der Vergangenheit,
--    um nicht in aktuellen Monatsfiltern aufzutauchen.
-- ------------------------------------------------------------
update public.touren set startdatum = '2023-01-01' where startdatum is null;
update public.touren set enddatum   = '2023-01-01' where enddatum   is null;

alter table public.touren
  alter column startdatum set not null,
  alter column enddatum   set not null;

-- ------------------------------------------------------------
-- 2. Rechnungsdatum (optional, abweichend vom Tourendatum).
--    rechnungsdatum_abweichend toggelt die UI; rechnungsdatum
--    enthält den abweichenden Wert (oder NULL).
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists rechnungsdatum_abweichend boolean not null default false,
  add column if not exists rechnungsdatum date;

-- ------------------------------------------------------------
-- 3. Tour-Zusätze sind preisrelevant — Fahrer dürfen sie weder
--    sehen noch zählen. Lese-Policy auf Admin-only umstellen.
--    (admin_write-Policy aus 012 bleibt unverändert.)
-- ------------------------------------------------------------
drop policy if exists tour_zusaetze_read on public.tour_zusaetze;
create policy tour_zusaetze_read on public.tour_zusaetze
  for select using (public.is_admin());
