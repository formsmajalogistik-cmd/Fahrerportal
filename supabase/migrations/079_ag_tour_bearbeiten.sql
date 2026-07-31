-- ============================================================
-- Maja-Logistik Business-Portal — 079: Auftraggeber bearbeiten
-- ihre eigenen Touren + Änderungsprotokoll
-- ------------------------------------------------------------
-- Auftraggeber dürfen "ihre" Felder einer eigenen Tour ändern —
-- unbestätigt UND bestätigt. Jede Änderung wird protokolliert, damit
-- der Admin sie prüfen kann.
--
-- SICHERHEIT (der kritische Teil):
--   Auftraggeber haben seit H-1 (063) KEIN UPDATE-Recht auf touren und
--   bekommen hier auch keines. Geschrieben wird ausschließlich über die
--   SECURITY-DEFINER-Funktion ag_tour_aktualisieren(), die
--     a) nur Touren des EIGENEN Auftraggebers anfasst,
--     b) NUR die unten stehende Whitelist schreibt — das SET-Statement
--        listet die erlaubten Spalten fest auf, geschützte Spalten
--        (verguetung, fahrer_id, fahrer_honorar, barauslagen, km_*,
--        bestaetigt, …) kommen darin gar nicht vor und können deshalb
--        auch dann nicht überschrieben werden, wenn das Frontend die
--        ganze Zeile mitschickt,
--     c) abgelehnte und bereits abgerechnete Touren ablehnt,
--     d) bestätigte Touren NICHT auf unbestätigt zurücksetzt.
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Änderungsprotokoll
-- ------------------------------------------------------------
create table if not exists public.tour_aenderungen (
  id            uuid primary key default gen_random_uuid(),
  tour_id       uuid not null references public.touren(id) on delete cascade,
  geaendert_von uuid references public.app_users(id) on delete set null,
  geaendert_am  timestamptz not null default now(),
  feld          text not null,
  wert_alt      text,
  wert_neu      text,
  gesehen_am    timestamptz,
  gesehen_von   uuid references public.app_users(id) on delete set null
);

create index if not exists idx_tour_aenderungen_tour
  on public.tour_aenderungen(tour_id);
-- Für die Badge-/Blip-Abfrage "was ist unquittiert?".
create index if not exists idx_tour_aenderungen_offen
  on public.tour_aenderungen(gesehen_am) where gesehen_am is null;

comment on table public.tour_aenderungen is
  'Protokoll der Auftraggeber-Änderungen an Touren. Pro geändertem Feld '
  'eine Zeile mit Alt-/Neu-Wert; der Admin quittiert mit gesehen_am.';

alter table public.tour_aenderungen enable row level security;

-- Admin-only: der Auftraggeber sieht seine Änderungen ohnehin in seiner
-- eigenen Tour-Ansicht, das Protokoll ist ein Admin-Werkzeug.
-- Geschrieben wird ausschließlich von ag_tour_aktualisieren() (DEFINER).
drop policy if exists tour_aenderungen_admin_all on public.tour_aenderungen;
create policy tour_aenderungen_admin_all on public.tour_aenderungen
  for all using (public.is_admin()) with check (public.is_admin());

grant select, update, delete on public.tour_aenderungen to authenticated;

-- ------------------------------------------------------------
-- 2. Ist eine Tour bereits abgerechnet?
--    SECURITY DEFINER, weil Auftraggeber keinen Zugriff auf
--    rechnungspositionen/gutschriftspositionen haben (Admin-only).
-- ------------------------------------------------------------
create or replace function public.tour_ist_abgerechnet(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rechnungspositionen rp where rp.tour_id = p_tour_id
  ) or exists (
    select 1 from public.gutschriftspositionen gp where gp.tour_id = p_tour_id
  );
$$;

revoke all on function public.tour_ist_abgerechnet(uuid) from public;
grant execute on function public.tour_ist_abgerechnet(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Kundensicht um die Bearbeitbarkeit erweitern.
--    Gleiche Definition wie 074, plus `abgerechnet`, `tourenart` als
--    editierbares Feld ist bereits enthalten.
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
  eingang_id_bc        uuid,
  abgerechnet          boolean
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
    t.eingang_id, t.eingang_id_bc,
    -- Abgerechnete Touren sind für den Auftraggeber gesperrt.
    (exists (select 1 from public.rechnungspositionen rp where rp.tour_id = t.id)
     or exists (select 1 from public.gutschriftspositionen gp where gp.tour_id = t.id))
      as abgerechnet
  from public.touren t
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid())
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

-- Lesbare Textform eines Feldwerts fürs Protokoll: Arrays als
-- kommaseparierte Liste, Objekte (Kontakte) als "Name, Telefon, E-Mail",
-- alles andere direkt.
create or replace function public.tour_feldwert_text(p_wert jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_wert is null or jsonb_typeof(p_wert) = 'null' then null
    when jsonb_typeof(p_wert) = 'array' then (
      select nullif(string_agg(e #>> '{}', ', '), '')
        from jsonb_array_elements(p_wert) e
    )
    when jsonb_typeof(p_wert) = 'object' then nullif(concat_ws(', ',
      nullif(btrim(coalesce(p_wert ->> 'name', '')), ''),
      nullif(btrim(coalesce(p_wert ->> 'telefon', '')), ''),
      nullif(btrim(coalesce(p_wert ->> 'email', '')), '')
    ), '')
    when jsonb_typeof(p_wert) = 'boolean' then
      case when (p_wert)::text = 'true' then 'ja' else 'nein' end
    else p_wert #>> '{}'
  end;
$$;

-- ------------------------------------------------------------
-- 4. Die eigentliche Update-RPC.
--
-- p_daten ist ein jsonb-Objekt mit den zu ändernden Feldern. Nicht
-- enthaltene Felder bleiben unverändert, NICHT-Whitelist-Felder werden
-- verworfen.
--
-- Rückgabe:
--   { ok, fehler, bestaetigt, tour_id, route, aenderungen: [{feld,alt,neu}] }
-- ------------------------------------------------------------
create or replace function public.ag_tour_aktualisieren(
  p_tour_id uuid,
  p_daten   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Genau diese Spalten darf ein Auftraggeber ändern. Die Liste dient
  -- dem Filtern der Eingabe UND dem Diff für das Protokoll; das
  -- UPDATE unten listet dieselben Spalten noch einmal fest auf.
  c_whitelist constant text[] := array[
    'start_stadt', 'ziel_stadt', 'rueckfuehrung_stadt',
    'adresse_start', 'adresse_ziel', 'adresse_rueckfuehrung',
    'kontakt_start', 'kontakt_ziel', 'kontakt_rueckfuehrung',
    'kennzeichen', 'fin', 'fin_rueck', 'kundenname',
    'startdatum', 'enddatum', 'tourenart', 'ist_e_fahrzeug', 'info'
  ];
  v_ag       uuid;
  v_alt      public.touren%rowtype;
  v_neu      public.touren%rowtype;
  v_erlaubt  jsonb := '{}'::jsonb;
  v_alt_j    jsonb;
  v_neu_j    jsonb;
  v_feld     text;
  v_alt_txt  text;
  v_neu_txt  text;
  v_liste    jsonb := '[]'::jsonb;
begin
  if not public.is_auftraggeber() then
    return jsonb_build_object('ok', false, 'fehler', 'Nur für Auftraggeber-Profile.');
  end if;
  v_ag := public.current_auftraggeber_id();
  if v_ag is null then
    return jsonb_build_object('ok', false, 'fehler', 'Ihrem Konto ist kein Auftraggeber zugeordnet.');
  end if;

  select * into v_alt from public.touren where id = p_tour_id;
  if not found or v_alt.auftraggeber_id is distinct from v_ag then
    -- Fremde Tour: bewusst dieselbe Meldung wie "nicht gefunden", damit
    -- die Existenz fremder Touren nicht durchsickert.
    return jsonb_build_object('ok', false, 'fehler', 'Tour nicht gefunden.');
  end if;
  if v_alt.abgelehnt then
    return jsonb_build_object('ok', false, 'fehler', 'Abgelehnte Touren können nicht bearbeitet werden.');
  end if;
  if public.tour_ist_abgerechnet(p_tour_id) then
    return jsonb_build_object(
      'ok', false,
      'fehler', 'Diese Tour wurde bereits abgerechnet. Bitte wenden Sie sich an Maja-Logistik.'
    );
  end if;

  -- Eingabe auf die Whitelist reduzieren. Alles andere fällt hier raus,
  -- bevor es überhaupt in die Nähe der Zeile kommt.
  if p_daten is not null and jsonb_typeof(p_daten) = 'object' then
    foreach v_feld in array c_whitelist loop
      if p_daten ? v_feld then
        v_erlaubt := v_erlaubt || jsonb_build_object(v_feld, p_daten -> v_feld);
      end if;
    end loop;
  end if;
  if v_erlaubt = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'aenderungen', '[]'::jsonb,
                              'bestaetigt', v_alt.bestaetigt,
                              'tour_id', v_alt.tour_id);
  end if;

  -- Die gefilterten Werte über die bestehende Zeile legen — dabei
  -- übernimmt jsonb_populate_record die Typumwandlung (date, text[],
  -- jsonb, boolean).
  v_neu := jsonb_populate_record(v_alt, v_erlaubt);

  v_alt_j := to_jsonb(v_alt);
  v_neu_j := to_jsonb(v_neu);

  -- Pro tatsächlich geändertem Feld einen Protokolleintrag.
  foreach v_feld in array c_whitelist loop
    if (v_alt_j -> v_feld) is distinct from (v_neu_j -> v_feld) then
      v_alt_txt := public.tour_feldwert_text(v_alt_j -> v_feld);
      v_neu_txt := public.tour_feldwert_text(v_neu_j -> v_feld);
      insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu)
      values (p_tour_id, auth.uid(), v_feld, v_alt_txt, v_neu_txt);
      v_liste := v_liste || jsonb_build_object(
        'feld', v_feld, 'alt', v_alt_txt, 'neu', v_neu_txt
      );
    end if;
  end loop;

  if jsonb_array_length(v_liste) = 0 then
    return jsonb_build_object('ok', true, 'aenderungen', '[]'::jsonb,
                              'bestaetigt', v_alt.bestaetigt,
                              'tour_id', v_alt.tour_id);
  end if;

  -- FESTE Spaltenliste — geschützte Spalten stehen hier bewusst nicht
  -- drin und bleiben damit unangetastet. Insbesondere `bestaetigt`:
  -- eine bestätigte Tour bleibt bestätigt.
  update public.touren set
    start_stadt           = v_neu.start_stadt,
    ziel_stadt            = v_neu.ziel_stadt,
    rueckfuehrung_stadt   = v_neu.rueckfuehrung_stadt,
    adresse_start         = v_neu.adresse_start,
    adresse_ziel          = v_neu.adresse_ziel,
    adresse_rueckfuehrung = v_neu.adresse_rueckfuehrung,
    kontakt_start         = v_neu.kontakt_start,
    kontakt_ziel          = v_neu.kontakt_ziel,
    kontakt_rueckfuehrung = v_neu.kontakt_rueckfuehrung,
    kennzeichen           = v_neu.kennzeichen,
    fin                   = v_neu.fin,
    fin_rueck             = v_neu.fin_rueck,
    kundenname            = v_neu.kundenname,
    startdatum            = v_neu.startdatum,
    enddatum              = v_neu.enddatum,
    tourenart             = v_neu.tourenart,
    ist_e_fahrzeug        = v_neu.ist_e_fahrzeug,
    info                  = v_neu.info
  where id = p_tour_id;

  return jsonb_build_object(
    'ok', true,
    'aenderungen', v_liste,
    'bestaetigt', v_alt.bestaetigt,
    'tour_id', v_alt.tour_id,
    'route', concat_ws(' → ', v_alt.start_stadt, v_alt.ziel_stadt, v_alt.rueckfuehrung_stadt)
  );
end;
$$;

revoke all on function public.tour_feldwert_text(jsonb) from public;
revoke all on function public.ag_tour_aktualisieren(uuid, jsonb) from public;
grant execute on function public.ag_tour_aktualisieren(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
