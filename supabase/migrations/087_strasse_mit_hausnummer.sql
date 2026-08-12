-- Migration 087: Hausnummer gehört ins Straßenfeld
--
-- 086 hatte Straße und Hausnummer als ZWEI Felder angelegt. In den
-- Formularen wird die Adresse aber in EINEM Feld erfasst
-- ("Heiligenroder Strasse 38e") — die Tour-Masken werden hier daran
-- angeglichen. PLZ und Stadt bleiben eigene Felder.
--
-- Zusammengesetzte Adresse ab jetzt: "{strasse}, {plz} {stadt}".
--
-- Bereits erfasste Hausnummern werden NICHT verworfen, sondern an die
-- Straße angehängt (Straße + Leerzeichen + Hausnummer), bevor die
-- Spalten fallen. Der Block ist gegen beide Ausgangslagen abgesichert:
-- 086 schon gelaufen (Spalten da) oder nicht (dann nichts zu tun).

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'touren'
       and column_name = 'hausnummer_start'
  ) then
    -- Zusammenführen: nur dort, wo wirklich eine Hausnummer steht, und
    -- nur wenn sie nicht schon in der Straße auftaucht (Idempotenz bei
    -- einem zweiten Lauf bzw. bei doppelt gepflegten Daten).
    update public.touren
       set strasse_start = btrim(concat_ws(' ',
             nullif(btrim(coalesce(strasse_start, '')), ''),
             nullif(btrim(hausnummer_start), '')))
     where nullif(btrim(coalesce(hausnummer_start, '')), '') is not null
       and coalesce(strasse_start, '') not like '%' || btrim(hausnummer_start) || '%';

    update public.touren
       set strasse_ziel = btrim(concat_ws(' ',
             nullif(btrim(coalesce(strasse_ziel, '')), ''),
             nullif(btrim(hausnummer_ziel), '')))
     where nullif(btrim(coalesce(hausnummer_ziel, '')), '') is not null
       and coalesce(strasse_ziel, '') not like '%' || btrim(hausnummer_ziel) || '%';

    update public.touren
       set strasse_rueckfuehrung = btrim(concat_ws(' ',
             nullif(btrim(coalesce(strasse_rueckfuehrung, '')), ''),
             nullif(btrim(hausnummer_rueckfuehrung), '')))
     where nullif(btrim(coalesce(hausnummer_rueckfuehrung, '')), '') is not null
       and coalesce(strasse_rueckfuehrung, '') not like '%' || btrim(hausnummer_rueckfuehrung) || '%';
  end if;
end $$;

alter table public.touren
  drop column if exists hausnummer_start,
  drop column if exists hausnummer_ziel,
  drop column if exists hausnummer_rueckfuehrung;

comment on column public.touren.strasse_start is
  'Straße inklusive Hausnummer, wie in den Formularen ("Heiligenroder Strasse 38e").';

-- ------------------------------------------------------------
-- 1. Whitelist ohne die Hausnummer-Felder.
-- ------------------------------------------------------------
create or replace function public.ag_tour_felder()
returns text[]
language sql
immutable
as $$
  select array[
    'start_stadt','ziel_stadt','rueckfuehrung_stadt',
    'adresse_start','adresse_ziel','adresse_rueckfuehrung',
    'strasse_start','plz_start',
    'strasse_ziel','plz_ziel',
    'strasse_rueckfuehrung','plz_rueckfuehrung',
    'kontakt_start','kontakt_ziel','kontakt_rueckfuehrung',
    'kennzeichen','fin','fin_rueck','kundenname',
    'startdatum','enddatum','tourenart','ist_e_fahrzeug','info',
    'fahrzeugmodell','fahrzeugmodell_rueck',
    'zeit_start','zeit_ziel','zeit_rueckfuehrung',
    'km_hin','km_rueck','km_gesamt','protokoll_art',
    'auf_eis','auf_eis_notiz'
  ]::text[];
$$;

-- ------------------------------------------------------------
-- 2. Kundensicht ohne die Hausnummer-Spalten (sonst wie 086).
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
  fahrzeugmodell       text,
  fahrzeugmodell_rueck text,
  zeit_start           text,
  zeit_ziel            text,
  zeit_rueckfuehrung   text,
  km_hin               integer,
  km_rueck             integer,
  km_gesamt            integer,
  adresse_start        text,
  adresse_ziel         text,
  adresse_rueckfuehrung text,
  strasse_start        text,
  plz_start            text,
  strasse_ziel         text,
  plz_ziel             text,
  strasse_rueckfuehrung text,
  plz_rueckfuehrung    text,
  kontakt_start        jsonb,
  kontakt_ziel         jsonb,
  kontakt_rueckfuehrung jsonb,
  protokoll_art        text,
  info                 text,
  auf_eis              boolean,
  auf_eis_notiz        text,
  auf_eis_seit         timestamptz,
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
    t.fahrzeugmodell, t.fahrzeugmodell_rueck,
    t.zeit_start, t.zeit_ziel, t.zeit_rueckfuehrung,
    t.km_hin, t.km_rueck, t.km_gesamt,
    t.adresse_start, t.adresse_ziel, t.adresse_rueckfuehrung,
    t.strasse_start, t.plz_start,
    t.strasse_ziel, t.plz_ziel,
    t.strasse_rueckfuehrung, t.plz_rueckfuehrung,
    t.kontakt_start, t.kontakt_ziel, t.kontakt_rueckfuehrung,
    t.protokoll_art, t.info,
    t.auf_eis, t.auf_eis_notiz, t.auf_eis_seit,
    t.bestaetigt, t.erstellt_von, t.created_at,
    t.abgelehnt, t.ablehnungsgrund, t.abgelehnt_am, t.ablehnung_bestaetigt_am,
    t.eingang_id, t.eingang_id_bc,
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
-- ------------------------------------------------------------
-- 3. Anlege- und Bearbeiten-RPC ohne die Hausnummer-Spalten.
--    Sonst unverändert zu 086.
-- ------------------------------------------------------------
create or replace function public.ag_tour_anlegen(p_daten jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag      uuid;
  v_erlaubt jsonb := '{}'::jsonb;
  v_feld    text;
  v_neu     public.touren%rowtype;
  v_id      uuid;
begin
  if not public.is_auftraggeber() then
    return jsonb_build_object('ok', false, 'fehler', 'Nur für Auftraggeber-Profile.');
  end if;
  v_ag := public.current_auftraggeber_id();
  if v_ag is null then
    return jsonb_build_object(
      'ok', false,
      'fehler', 'Ihrem Konto ist kein Auftraggeber zugeordnet.'
    );
  end if;

  -- Eingabe auf die Whitelist reduzieren. Alles andere — insbesondere
  -- auftraggeber_id, bestaetigt, verguetung, fahrer_id — fällt hier raus,
  -- bevor es die Zeile berührt.
  if p_daten is not null and jsonb_typeof(p_daten) = 'object' then
    foreach v_feld in array public.ag_tour_felder() loop
      if p_daten ? v_feld then
        v_erlaubt := v_erlaubt || jsonb_build_object(v_feld, p_daten -> v_feld);
      end if;
    end loop;
  end if;

  -- Über einen leeren Datensatz legen: jsonb_populate_record übernimmt
  -- die Typumwandlung (date, text[], jsonb, boolean, integer).
  v_neu := jsonb_populate_record(null::public.touren, v_erlaubt);

  if coalesce(btrim(v_neu.start_stadt), '') = ''
     or coalesce(btrim(v_neu.ziel_stadt), '') = '' then
    return jsonb_build_object('ok', false, 'fehler', 'Start- und Ziel-Stadt sind Pflichtfelder.');
  end if;
  -- Datum ist Pflicht — AUSSER die Tour wird bewusst auf Eis gelegt
  -- (steht fest, Termin noch offen).
  if not coalesce(v_neu.auf_eis, false)
     and (v_neu.startdatum is null or v_neu.enddatum is null) then
    return jsonb_build_object('ok', false, 'fehler',
      'Start- und Enddatum sind Pflichtfelder. Ohne festen Termin bitte die Tour auf Eis legen.');
  end if;

  -- FESTE Spaltenliste. Die Kopfdaten setzt der Server, NICHT der Client.
  insert into public.touren (
    start_stadt, ziel_stadt, rueckfuehrung_stadt,
    adresse_start, adresse_ziel, adresse_rueckfuehrung,
    strasse_start, plz_start,
    strasse_ziel, plz_ziel,
    strasse_rueckfuehrung, plz_rueckfuehrung,
    kontakt_start, kontakt_ziel, kontakt_rueckfuehrung,
    kennzeichen, fin, fin_rueck, kundenname,
    startdatum, enddatum, tourenart, ist_e_fahrzeug, info,
    fahrzeugmodell, fahrzeugmodell_rueck,
    zeit_start, zeit_ziel, zeit_rueckfuehrung,
    km_hin, km_rueck, km_gesamt, protokoll_art,
    auf_eis, auf_eis_notiz, auf_eis_seit,
    auftraggeber_id, bestaetigt, erstellt_von, erstellt_von_rolle
  ) values (
    btrim(v_neu.start_stadt), btrim(v_neu.ziel_stadt), v_neu.rueckfuehrung_stadt,
    v_neu.adresse_start, v_neu.adresse_ziel, v_neu.adresse_rueckfuehrung,
    v_neu.strasse_start, v_neu.plz_start,
    v_neu.strasse_ziel, v_neu.plz_ziel,
    v_neu.strasse_rueckfuehrung, v_neu.plz_rueckfuehrung,
    v_neu.kontakt_start, v_neu.kontakt_ziel, v_neu.kontakt_rueckfuehrung,
    coalesce(v_neu.kennzeichen, '{}'), v_neu.fin, v_neu.fin_rueck, v_neu.kundenname,
    v_neu.startdatum, v_neu.enddatum, v_neu.tourenart,
    coalesce(v_neu.ist_e_fahrzeug, false), v_neu.info,
    v_neu.fahrzeugmodell, v_neu.fahrzeugmodell_rueck,
    v_neu.zeit_start, v_neu.zeit_ziel, v_neu.zeit_rueckfuehrung,
    v_neu.km_hin, v_neu.km_rueck, v_neu.km_gesamt, v_neu.protokoll_art,
    coalesce(v_neu.auf_eis, false), v_neu.auf_eis_notiz,
    -- Zeitstempel serverseitig, nicht aus dem Payload:
    case when coalesce(v_neu.auf_eis, false) then now() else null end,
    -- Serverseitig gesetzt — nicht aus dem Payload:
    v_ag, false, auth.uid(), 'auftraggeber'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.ag_tour_anlegen(jsonb) from public;
grant execute on function public.ag_tour_anlegen(jsonb) to authenticated;

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
  c_whitelist constant text[] := public.ag_tour_felder();
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

  v_neu := jsonb_populate_record(v_alt, v_erlaubt);

  -- Solange die Tour auf Eis liegt, darf das Datum leer sein. Wird die
  -- Terminierung wieder aktiviert, ist es erneut Pflicht.
  if not coalesce(v_neu.auf_eis, false)
     and (v_neu.startdatum is null or v_neu.enddatum is null) then
    return jsonb_build_object('ok', false, 'fehler',
      'Ohne "auf Eis" sind Start- und Enddatum Pflichtfelder.');
  end if;

  v_alt_j := to_jsonb(v_alt);
  v_neu_j := to_jsonb(v_neu);

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

  update public.touren set
    start_stadt           = v_neu.start_stadt,
    ziel_stadt            = v_neu.ziel_stadt,
    rueckfuehrung_stadt   = v_neu.rueckfuehrung_stadt,
    adresse_start         = v_neu.adresse_start,
    adresse_ziel          = v_neu.adresse_ziel,
    adresse_rueckfuehrung = v_neu.adresse_rueckfuehrung,
    strasse_start            = v_neu.strasse_start,
    plz_start                = v_neu.plz_start,
    strasse_ziel             = v_neu.strasse_ziel,
    plz_ziel                 = v_neu.plz_ziel,
    strasse_rueckfuehrung    = v_neu.strasse_rueckfuehrung,
    plz_rueckfuehrung        = v_neu.plz_rueckfuehrung,
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
    info                  = v_neu.info,
    fahrzeugmodell        = v_neu.fahrzeugmodell,
    fahrzeugmodell_rueck  = v_neu.fahrzeugmodell_rueck,
    zeit_start            = v_neu.zeit_start,
    zeit_ziel             = v_neu.zeit_ziel,
    zeit_rueckfuehrung    = v_neu.zeit_rueckfuehrung,
    km_hin                = v_neu.km_hin,
    km_rueck              = v_neu.km_rueck,
    km_gesamt             = v_neu.km_gesamt,
    protokoll_art         = v_neu.protokoll_art,
    auf_eis               = coalesce(v_neu.auf_eis, false),
    auf_eis_notiz         = v_neu.auf_eis_notiz,
    -- Zeitstempel serverseitig: beim Auf-Eis-Legen setzen, beim
    -- Aufheben leeren, sonst unverändert lassen.
    auf_eis_seit          = case
                              when coalesce(v_neu.auf_eis, false) = false then null
                              when v_alt.auf_eis then v_alt.auf_eis_seit
                              else now()
                            end
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

revoke all on function public.ag_tour_aktualisieren(uuid, jsonb) from public;
grant execute on function public.ag_tour_aktualisieren(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
