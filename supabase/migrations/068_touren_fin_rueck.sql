-- ============================================================
-- Maja-Logistik Business-Portal — 068: FIN für die Rücktour
-- ------------------------------------------------------------
-- Analog zum Rücktour-Kennzeichen (kennzeichen[1]) bekommt die
-- Rückführung eine eigene FIN. Optional/nullable — nicht jede Tour
-- hat eine Rückführung; Bestandstouren bleiben unverändert (NULL).
--
-- Die Kundensicht-View wird um die neue Spalte erweitert (dort sind
-- Rück-Kennzeichen und FIN bereits enthalten). DROP + CREATE wie in
-- 057, damit die Spaltenliste sauber ersetzt wird; security_invoker
-- und die doppelte Filter-Logik bleiben identisch.
--
-- Idempotent.
-- ============================================================

alter table public.touren
  add column if not exists fin_rueck text;

comment on column public.touren.fin_rueck is
  'FIN des Rückführungs-Fahrzeugs (analog kennzeichen[1]). NULL, wenn keine Rückführung.';

drop view if exists public.touren_kundensicht;
create view public.touren_kundensicht
  with (security_invoker = true)
as
  select
    t.id, t.tour_id,
    t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt,
    t.kundenname, t.auftraggeber_id,
    t.startdatum, t.enddatum, t.tourenart,
    t.kennzeichen, t.ist_e_fahrzeug, t.fin, t.fin_rueck,
    t.adresse_start, t.adresse_ziel, t.adresse_rueckfuehrung,
    t.kontakt_start, t.kontakt_ziel, t.kontakt_rueckfuehrung,
    t.protokoll_art, t.info,
    t.bestaetigt, t.erstellt_von, t.created_at,
    t.eingang_id, t.eingang_id_bc
  from public.touren t
  -- Redundant zur RLS-Policy — bewusst als zweite
  -- Verteidigungslinie beibehalten (siehe 057).
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid());

grant select on public.touren_kundensicht to authenticated;

notify pgrst, 'reload schema';
