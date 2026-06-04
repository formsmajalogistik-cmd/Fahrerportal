-- ============================================================
-- Maja-Logistik Business-Portal — 049: Rechnungsempfänger auf
-- Rechnungen.
-- ------------------------------------------------------------
-- Pro Tour kann ein Rechnungsempfänger aus auftraggeber_kontakte
-- gewählt werden (touren.kontakt_id). Bei der Rechnungserstellung
-- wollen wir die Touren nach diesem Empfänger filtern und das
-- Ergebnis fest auf der Rechnung verankern. Dafür kommt ein
-- nullable FK rechnungsempfaenger_id auf rechnungen — ON DELETE
-- SET NULL, damit gelöschte Kontakte historische Rechnungen
-- nicht kaputtmachen.
-- ============================================================

alter table public.rechnungen
  add column if not exists rechnungsempfaenger_id uuid
    references public.auftraggeber_kontakte(id) on delete set null;

create index if not exists idx_rechnungen_rechnungsempfaenger
  on public.rechnungen (rechnungsempfaenger_id);

notify pgrst, 'reload schema';
