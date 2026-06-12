-- ============================================================
-- Maja-Logistik Business-Portal — 057: touren_kundensicht auf
-- security_invoker umstellen (Supabase Security Advisor: CRITICAL
-- "View is defined with the SECURITY DEFINER property").
-- ------------------------------------------------------------
-- Neue Sicherheits-Kette für Auftraggeber-Profile:
--
--   * ZEILEN-Einschränkung: RLS-Policy auf public.touren
--     (touren_auftraggeber_read) — nur Touren des eigenen
--     Auftraggebers, davon nur bestätigte plus selbst erstellte.
--   * SPALTEN-Einschränkung: die View touren_kundensicht enthält
--     keine verguetung-/fahrer-Spalten und ist die einzige Quelle,
--     die das Frontend für diese Rolle abfragt.
--
-- Mit security_invoker = true laufen Abfragen der View mit den
-- Rechten (und RLS-Policies) des eingeloggten Nutzers — die View
-- umgeht RLS nicht mehr. Das redundante WHERE in der View bleibt als
-- zweite Verteidigungslinie bestehen (Defense in Depth).
--
-- WICHTIG: Ohne die neue SELECT-Policy sähen Auftraggeber nach der
-- Umstellung GAR NICHTS mehr — Policy und View-Umstellung gehören
-- zwingend zusammen.
--
-- Idempotent; läuft auch in Umgebungen, in denen 056 die View noch
-- als (implizit) SECURITY DEFINER angelegt hat.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SELECT-Policy auf touren für die Rolle auftraggeber.
--    Scope identisch zum bisherigen View-WHERE: eigener Auftraggeber,
--    bestätigte plus selbst erstellte unbestätigte Touren.
-- ------------------------------------------------------------

drop policy if exists touren_auftraggeber_read on public.touren;
create policy touren_auftraggeber_read on public.touren
  for select using (
    public.is_auftraggeber()
    and auftraggeber_id is not null
    and auftraggeber_id = public.current_auftraggeber_id()
    and (bestaetigt = true or erstellt_von = auth.uid())
  );

-- ------------------------------------------------------------
-- 2. View mit security_invoker neu anlegen. DROP + CREATE statt
--    ALTER, damit die Migration auch dann durchläuft, wenn die View
--    in einer Umgebung (noch) nicht existiert.
-- ------------------------------------------------------------

drop view if exists public.touren_kundensicht;
create view public.touren_kundensicht
  with (security_invoker = true)
as
  select
    t.id, t.tour_id,
    t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt,
    t.kundenname, t.auftraggeber_id,
    t.startdatum, t.enddatum, t.tourenart,
    t.kennzeichen, t.ist_e_fahrzeug, t.fin,
    t.adresse_start, t.adresse_ziel, t.adresse_rueckfuehrung,
    t.kontakt_start, t.kontakt_ziel, t.kontakt_rueckfuehrung,
    t.protokoll_art, t.info,
    t.bestaetigt, t.erstellt_von, t.created_at,
    t.eingang_id, t.eingang_id_bc
  from public.touren t
  -- Redundant zur RLS-Policy oben — bewusst als zweite
  -- Verteidigungslinie beibehalten.
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid());

grant select on public.touren_kundensicht to authenticated;

notify pgrst, 'reload schema';
