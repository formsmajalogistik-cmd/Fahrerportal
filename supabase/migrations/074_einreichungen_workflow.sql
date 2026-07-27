-- ============================================================
-- Maja-Logistik Business-Portal — 074: Einreichungs-Workflow
-- ------------------------------------------------------------
-- Punkt 2: Abgelehnte Touren bleiben beim Auftraggeber dauerhaft rot.
--   → ablehnung_bestaetigt_am ("Verstanden"-Button). Die Tour bleibt
--     in der DB und für Admins sichtbar, verschwindet aber aus der
--     Auftraggeber-Liste. Zusätzlich Auto-Ausblenden nach 14 Tagen.
--   → Auftraggeber haben seit H-1 (063) KEIN UPDATE-Recht auf touren.
--     Das Bestätigen läuft daher über eine SECURITY-DEFINER-RPC, die
--     ausschließlich dieses eine Feld und nur an EIGENEN, abgelehnten
--     Touren setzt.
--
-- Punkt 4: Sehr viele/zukünftige Einreichungen überladen den Bereich
--   "Zur Bestätigung".
--   → zurueckgestellt / zurueckgestellt_am ("Später"-Button, Admin).
--
-- Punkt 1: Der Notification-Blip zählte alle bestaetigt=false — also
--   auch abgelehnte. Die Zähl-Logik im Frontend zählt jetzt nur noch
--   offene, nicht zurückgestellte Einreichungen im 14-Tage-Fenster.
--
-- Idempotent.
-- ============================================================

alter table public.touren
  add column if not exists ablehnung_bestaetigt_am timestamptz,
  add column if not exists zurueckgestellt         boolean not null default false,
  add column if not exists zurueckgestellt_am      timestamptz;

comment on column public.touren.ablehnung_bestaetigt_am is
  'Auftraggeber hat die Ablehnung zur Kenntnis genommen ("Verstanden") — '
  'Tour wird ihm nicht mehr angezeigt, bleibt für Admins erhalten.';
comment on column public.touren.zurueckgestellt is
  'Vom Admin zurückgestellte Einreichung — raus aus "Zur Bestätigung", '
  'zählt nicht für den Notification-Blip.';

-- ------------------------------------------------------------
-- 1. Kundensicht: neue Spalte mitliefern + abgelehnte Touren
--    ausblenden, sobald bestätigt ODER älter als 14 Tage.
-- ------------------------------------------------------------

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
  ablehnung_bestaetigt_am timestamptz,
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
    t.abgelehnt, t.ablehnungsgrund, t.abgelehnt_am, t.ablehnung_bestaetigt_am,
    t.eingang_id, t.eingang_id_bc
  from public.touren t
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid())
    -- Abgelehnte Touren nur, solange nicht "verstanden" UND jünger als
    -- 14 Tage — danach blenden sie sich beim Auftraggeber selbst aus.
    and (
      t.abgelehnt = false
      or (
        t.ablehnung_bestaetigt_am is null
        and coalesce(t.abgelehnt_am, now()) > now() - interval '14 days'
      )
    );
$$;

revoke all on function public.touren_kundensicht_rows() from public;
grant execute on function public.touren_kundensicht_rows() to authenticated;

create view public.touren_kundensicht
  with (security_invoker = true)
as
  select * from public.touren_kundensicht_rows();

grant select on public.touren_kundensicht to authenticated;

-- H-1 bleibt: keine breite SELECT-Policy auf touren für Auftraggeber.
drop policy if exists touren_auftraggeber_read on public.touren;

-- ------------------------------------------------------------
-- 2. RPC "Verstanden" — Auftraggeber quittiert eine Ablehnung.
--    SECURITY DEFINER, weil Auftraggeber kein UPDATE auf touren haben.
--    Setzt NUR ablehnung_bestaetigt_am und NUR an einer abgelehnten
--    Tour des EIGENEN Auftraggebers.
-- ------------------------------------------------------------

create or replace function public.ag_ablehnung_bestaetigen(p_tour_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag uuid;
begin
  if not public.is_auftraggeber() then
    raise exception 'Nur für Auftraggeber-Profile';
  end if;
  v_ag := public.current_auftraggeber_id();
  if v_ag is null then
    return false;
  end if;
  update public.touren
     set ablehnung_bestaetigt_am = now()
   where id = p_tour_id
     and auftraggeber_id = v_ag
     and abgelehnt = true
     and ablehnung_bestaetigt_am is null;
  return found;
end;
$$;

revoke all on function public.ag_ablehnung_bestaetigen(uuid) from public;
grant execute on function public.ag_ablehnung_bestaetigen(uuid) to authenticated;

notify pgrst, 'reload schema';
