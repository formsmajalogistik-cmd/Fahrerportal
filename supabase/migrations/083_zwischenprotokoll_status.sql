-- ============================================================
-- Maja-Logistik Business-Portal — 083: Zwischenprotokoll-Status
-- ------------------------------------------------------------
-- Hintergrund (Regression nach der Umstellung auf die zusammengeführte
-- Gesamt-PDF): Die Kette lautete
--     PDF erzeugen → mergen → E-Mail mit Anhang senden
-- und der Aufrufer brach im catch der Erzeugung mit `return` ab. Jede
-- Störung beim Erzeugen/Mergen hat damit auch den VERSAND verhindert —
-- vorher kam wenigstens die Mail ohne Anhang.
--
-- Die Kette wird entkoppelt (Frontend). Damit ein Fehlschlag nicht mehr
-- still verschwindet, bekommt der Eingang eigene Statusfelder:
--
--   zwischenprotokoll_status      'ok' | 'fehler'
--   zwischenprotokoll_fehler      Klartext-Fehler der letzten Erzeugung
--   zwischenprotokoll_versendet_am  getrennt vom finalen Versand
--
-- Bewusst eigene Spalten statt pdf_status/pdf_fehler: die gehören zur
-- finalen PDF-Erzeugung und würden sonst gegenseitig überschrieben.
--
-- Idempotent.
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists zwischenprotokoll_status       text,
  add column if not exists zwischenprotokoll_fehler       text,
  add column if not exists zwischenprotokoll_versendet_am timestamptz;

comment on column public.ausgefuellte_formulare.zwischenprotokoll_status is
  'Ergebnis der letzten Zwischenprotokoll-Erzeugung: ok | fehler.';
comment on column public.ausgefuellte_formulare.zwischenprotokoll_fehler is
  'Klartext-Fehler der letzten Erzeugung — wird in Eingänge angezeigt.';
comment on column public.ausgefuellte_formulare.zwischenprotokoll_versendet_am is
  'Letzter Versand der Zwischenprotokoll-E-Mail. Getrennt vom Versand '
  'des finalen Protokolls.';

notify pgrst, 'reload schema';
