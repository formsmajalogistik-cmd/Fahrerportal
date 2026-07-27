-- ============================================================
-- Maja-Logistik Business-Portal — 072: Kundensicht reparieren
-- ------------------------------------------------------------
-- BUG: Auftraggeber-Profile sahen KEINE Touren mehr.
--
-- Ursache: Der H-1-Fix (063) hatte die Kundensicht auf eine
-- SECURITY-DEFINER-Funktion (touren_kundensicht_rows) umgestellt und
-- die breite SELECT-Policy `touren_auftraggeber_read` auf public.touren
-- ENTFERNT — Auftraggeber haben seitdem bewusst KEINEN direkten
-- Zeilenzugriff mehr auf touren.
--
-- Die Migrationen 068 (fin_rueck) und 070 (abgelehnt) haben die View
-- danach aber mit der ALTEN Definition aus 057 neu angelegt:
--   create view ... with (security_invoker = true) as select ... from touren
-- Mit security_invoker gilt die RLS des AUFRUFERS — und die erlaubt dem
-- Auftraggeber seit 063 nichts mehr. Ergebnis: die View lieferte 0
-- Zeilen. (Empirisch reproduziert: 2 Zeilen vor 068/070, 0 danach.)
--
-- Fix: Die Definer-Funktion aus 063 wiederherstellen — ergänzt um die
-- seither hinzugekommenen Spalten (fin_rueck aus 068; abgelehnt,
-- ablehnungsgrund, abgelehnt_am aus 070) — und die View wieder auf die
-- Funktion stellen.
--
-- Der H-1-Schutz bleibt vollständig erhalten:
--   * touren_auftraggeber_read wird NICHT wieder angelegt.
--   * Die Funktion selektiert nur unkritische Spalten — verguetung,
--     fahrer_id, fahrer_honorar, barauslagen sind NICHT enthalten und
--     damit auch per Direkt-API nicht erreichbar.
--
-- Idempotent.
-- ============================================================

-- Rückgabetyp ändert sich (neue Spalten) → alte Funktion zuerst weg.
-- Die View hängt daran, wird unten neu erzeugt.
drop view if exists public.touren_kundensicht;
drop function if exists public.touren_kundensicht_rows();

create function public.touren_kundensicht_rows()
returns table (
  id                   uuid,
  tour_id              text,
  start_stadt          text,
  ziel_stadt           text,
  rueckfuehrung_stadt  text,
  kundenname           text,
  auftraggeber_id      uuid,
  startdatum           date,
  enddatum             date,
  tourenart            text,
  kennzeichen          text[],
  ist_e_fahrzeug       boolean,
  fin                  text,
  fin_rueck            text,
  adresse_start        text,
  adresse_ziel         text,
  adresse_rueckfuehrung text,
  kontakt_start        jsonb,
  kontakt_ziel         jsonb,
  kontakt_rueckfuehrung jsonb,
  protokoll_art        text,
  info                 text,
  bestaetigt           boolean,
  erstellt_von         uuid,
  created_at           timestamptz,
  abgelehnt            boolean,
  ablehnungsgrund      text,
  abgelehnt_am         timestamptz,
  eingang_id           uuid,
  eingang_id_bc        uuid
)
language sql
stable
security definer
set search_path = public
as $$
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
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid());
$$;

revoke all on function public.touren_kundensicht_rows() from public;
grant execute on function public.touren_kundensicht_rows() to authenticated;

-- View wieder auf die Definer-Funktion (wie 063). security_invoker
-- bleibt: die View greift nicht mehr direkt auf touren zu, sondern ruft
-- die Funktion — der Aufrufer braucht nur EXECUTE.
create view public.touren_kundensicht
  with (security_invoker = true)
as
  select * from public.touren_kundensicht_rows();

grant select on public.touren_kundensicht to authenticated;

-- Sicherheitsnetz: Falls eine spätere Migration die breite Policy
-- versehentlich wieder angelegt hat, hier erneut entfernen (H-1).
drop policy if exists touren_auftraggeber_read on public.touren;

notify pgrst, 'reload schema';
