-- ============================================================
-- Maja-Logistik Business-Portal — 060: Indizes für die Eingänge-Liste
-- ------------------------------------------------------------
-- Die Eingänge-Seite (ausgefuellte_formulare) lädt jetzt paginiert,
-- gefiltert nach status und einem Zeitfenster (created_at), sortiert
-- nach created_at desc. Diese Indizes bedienen genau diese Query.
--
-- Hinweis: Es gibt KEINE kennzeichen-Spalte auf ausgefuellte_formulare
-- (das Kennzeichen liegt im jsonb-Feld `daten`). Daher kein btree-Index
-- auf "kennzeichen" — die Liste filtert/sortiert nicht danach.
--
-- Idempotent (create index if not exists).
-- ============================================================

-- Reine Sortierung/Zeitfenster (Tab "Alle").
create index if not exists idx_af_created_at
  on public.ausgefuellte_formulare (created_at desc);

-- Kombinierter Filter status + Sortierung created_at (Tabs
-- "Eingereicht" / "Entwürfe"): deckt eq(status) + order(created_at desc)
-- in einem Index ab.
create index if not exists idx_af_status_created_at
  on public.ausgefuellte_formulare (status, created_at desc);

notify pgrst, 'reload schema';
