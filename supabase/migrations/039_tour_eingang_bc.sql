-- ============================================================
-- Maja-Logistik Business-Portal — 039: Zweiter Protokoll-Slot
-- für ABA/ABC-Touren.
-- ------------------------------------------------------------
-- ABA- und ABC-Touren bestehen logisch aus zwei Streckenabschnitten
-- und werden in der Praxis mit ZWEI Protokoll-Formularen erfasst
-- (eines für den AB-Teil, eines für den BC/BA-Teil).
--
-- Bisher hatte touren genau ein `eingang_id`, das nach der ersten
-- Verknüpfung den Tour aus der Auswahlliste entfernte — das zweite
-- Formular ließ sich nicht mehr koppeln.
--
-- Lösung: zweites Slot-Feld `eingang_id_bc` (BC bzw. Rück-Teil). Die
-- bestehende Spalte `eingang_id` bleibt der AB-Slot (kompatibel zu
-- allen bisherigen Queries). Reines AB-Tour-Verhalten ist unverändert.
--
-- `protokoll_daten_felder_bc` analog zu `protokoll_daten_felder`:
-- speichert die durch das BC-Protokoll gefüllten Tour-Spalten, damit
-- beim Lösen NUR diese zurückgesetzt werden.
-- ============================================================

alter table public.touren
  add column if not exists eingang_id_bc uuid
    references public.ausgefuellte_formulare(id) on delete set null,
  add column if not exists protokoll_daten_felder_bc text[] not null default '{}';

create index if not exists idx_touren_eingang_bc on public.touren(eingang_id_bc);

notify pgrst, 'reload schema';
