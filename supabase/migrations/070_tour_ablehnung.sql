-- ============================================================
-- Maja-Logistik Business-Portal — 070: Auftraggeber-Tour ablehnen
-- ------------------------------------------------------------
-- Von Auftraggeber-Profilen eingereichte Touren (bestaetigt = false)
-- konnten bisher nur bestätigt oder HART GELÖSCHT werden. Jetzt:
-- Ablehnen mit Grund — die Tour bleibt nachvollziehbar erhalten,
-- verschwindet aus dem Bestätigungs-Bereich und wird dem Auftraggeber
-- als "Abgelehnt" (inkl. Grund) angezeigt.
--
-- Kundensicht-View wird um die neuen Spalten erweitert (DROP + CREATE
-- wie in 057/068; security_invoker + doppelte Filter-Logik identisch).
--
-- Idempotent.
-- ============================================================

alter table public.touren
  add column if not exists abgelehnt       boolean not null default false,
  add column if not exists ablehnungsgrund text,
  add column if not exists abgelehnt_am    timestamptz;

comment on column public.touren.abgelehnt is
  'Vom Admin abgelehnte Auftraggeber-Einreichung (kein Hard-Delete — '
  'bleibt für Auftraggeber-Sicht und Nachvollziehbarkeit erhalten).';

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
    t.abgelehnt, t.ablehnungsgrund, t.abgelehnt_am,
    t.eingang_id, t.eingang_id_bc
  from public.touren t
  -- Redundant zur RLS-Policy — bewusst als zweite
  -- Verteidigungslinie beibehalten (siehe 057).
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid());

grant select on public.touren_kundensicht to authenticated;

notify pgrst, 'reload schema';
