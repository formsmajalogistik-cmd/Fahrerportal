-- ============================================================
-- Maja-Logistik Business-Portal — 026: Protokoll-Verknüpfung
-- rückgängig machbar
-- ------------------------------------------------------------
-- Beim Verknüpfen eines Eingangs/Protokolls mit einer Tour werden
-- leere Tour-Felder automatisch aus dem Protokoll befüllt. Damit
-- der Admin diese Verknüpfung wieder lösen UND die übernommenen
-- Daten zurücksetzen kann, merken wir uns die Liste der Felder,
-- die durch die Verknüpfung gesetzt wurden.
-- ============================================================

alter table public.touren
  add column if not exists protokoll_daten_felder text[] not null default '{}';
