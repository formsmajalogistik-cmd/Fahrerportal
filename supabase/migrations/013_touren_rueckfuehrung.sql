-- ============================================================
-- Maja-Logistik Business-Portal — 013: Tourenmodell anpassen
-- ------------------------------------------------------------
-- Ersetzt das Zwischenstopp-Konzept durch eine optionale Rückführung.
-- Fügt Adressen-Felder und Kundenname hinzu.
--
--   ENTFERNT:
--     touren.zwischenstopps                 (jsonb)
--     touren.km_start_bis_erster_stopp      (integer)
--     touren.km_letzter_stopp_bis_ziel      (integer)
--
--   NEU:
--     touren.rueckfuehrung_stadt            text
--     touren.km_hin                         integer
--     touren.km_rueck                       integer
--     touren.adresse_start                  text
--     touren.adresse_ziel                   text
--     touren.adresse_rueckfuehrung          text
--     touren.kundenname                     text
-- ============================================================

alter table public.touren
  add column if not exists rueckfuehrung_stadt    text,
  add column if not exists km_hin                 integer,
  add column if not exists km_rueck               integer,
  add column if not exists adresse_start          text,
  add column if not exists adresse_ziel           text,
  add column if not exists adresse_rueckfuehrung  text,
  add column if not exists kundenname             text;

alter table public.touren
  drop column if exists zwischenstopps,
  drop column if exists km_start_bis_erster_stopp,
  drop column if exists km_letzter_stopp_bis_ziel;
