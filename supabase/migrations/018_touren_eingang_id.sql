-- ============================================================
-- Maja-Logistik Business-Portal — 018: touren.eingang_id
-- ------------------------------------------------------------
-- Verknüpft eine Tour mit dem Eingang (ausgefuellte_formulare), aus
-- dem sie erstellt wurde. Damit kann das Eingänge-UI die zugehörige
-- Tour anzeigen und das Tour-Detail-Panel die PDFs des Eingangs
-- direkt zum Download anbieten.
-- ============================================================

alter table public.touren
  add column if not exists eingang_id uuid;

alter table public.touren
  drop constraint if exists touren_eingang_id_fkey;
alter table public.touren
  add constraint touren_eingang_id_fkey
  foreign key (eingang_id)
  references public.ausgefuellte_formulare(id)
  on delete set null;

create index if not exists idx_touren_eingang_id
  on public.touren(eingang_id);
