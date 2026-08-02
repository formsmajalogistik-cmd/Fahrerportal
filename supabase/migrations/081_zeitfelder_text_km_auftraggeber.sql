-- ============================================================
-- Maja-Logistik Business-Portal — 081: Zeitangaben als Freitext,
-- km-Felder für Auftraggeber
-- ------------------------------------------------------------
-- 1. Zeitangaben: die in 080 angelegte Kombination aus `time`-Spalte
--    plus separatem Hinweis-Freitext hat sich in der Praxis nicht
--    bewährt — zwei Eingabefelder je Station sind zu viel und das
--    time-Input sprengt auf schmalen Breiten das Layout.
--    Stattdessen genau EIN Textfeld je Station:
--      zeit_start / zeit_ziel / zeit_rueckfuehrung
--    Damit sind "08:00" und "vormittags" gleichermaßen möglich.
--    Vorhandene Werte werden zusammengeführt, danach entfallen die
--    alten Spalten.
--
-- 2. km-Felder (km_hin, km_rueck, km_gesamt) kommen in die
--    Auftraggeber-Whitelist. Die PREISFELDER bleiben unverändert
--    gesperrt: verguetung, fahrer_honorar, barauslagen, fahrer_id,
--    bestaetigt … stehen weiterhin weder in der Whitelist noch im
--    UPDATE-Statement. Eine km-Änderung des Auftraggebers löst KEINE
--    Preisberechnung aus — calculate_tour_price() ist eine RPC, die
--    ausschließlich der Admin-Client aufruft, kein Trigger.
--
-- 3. routen_cache: Auftraggeber dürfen lesen und schreiben, damit der
--    "Entfernung berechnen"-Button auch in ihrer Ansicht funktioniert.
--    Der Cache enthält nur Adresse→Distanz, keine Preis- oder
--    Fahrerdaten.
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Neue Textspalten + Werte übernehmen
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists zeit_start         text,
  add column if not exists zeit_ziel          text,
  add column if not exists zeit_rueckfuehrung text;

comment on column public.touren.zeit_start is
  'Freitext-Zeitangabe der Startstation ("08:00", "vormittags", '
  '"nach Absprache"). Optional.';

-- Alte Werte zusammenführen: "08:00" + "vormittags" → "08:00 vormittags".
-- Nur füllen, wo das neue Feld noch leer ist (Idempotenz).
do $migration$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'touren'
       and column_name = 'abholzeit'
  ) then
    update public.touren
       set zeit_start = nullif(btrim(concat_ws(' ',
             case when abholzeit is not null then to_char(abholzeit, 'HH24:MI') end,
             nullif(btrim(coalesce(zeit_hinweis_start, '')), '')
           )), '')
     where zeit_start is null
       and (abholzeit is not null
            or nullif(btrim(coalesce(zeit_hinweis_start, '')), '') is not null);

    update public.touren
       set zeit_ziel = nullif(btrim(concat_ws(' ',
             case when abgabezeit is not null then to_char(abgabezeit, 'HH24:MI') end,
             nullif(btrim(coalesce(zeit_hinweis_ziel, '')), '')
           )), '')
     where zeit_ziel is null
       and (abgabezeit is not null
            or nullif(btrim(coalesce(zeit_hinweis_ziel, '')), '') is not null);

    update public.touren
       set zeit_rueckfuehrung = nullif(btrim(concat_ws(' ',
             case when rueckfuehrung_zeit is not null then to_char(rueckfuehrung_zeit, 'HH24:MI') end,
             nullif(btrim(coalesce(zeit_hinweis_rueckfuehrung, '')), '')
           )), '')
     where zeit_rueckfuehrung is null
       and (rueckfuehrung_zeit is not null
            or nullif(btrim(coalesce(zeit_hinweis_rueckfuehrung, '')), '') is not null);
  end if;
end
$migration$;

-- Die Kundensicht referenziert die alten Spalten — erst neu bauen,
-- dann können sie fallen.
drop view if exists public.touren_kundensicht;
drop function if exists public.touren_kundensicht_rows();

alter table public.touren
  drop column if exists abholzeit,
  drop column if exists abgabezeit,
  drop column if exists rueckfuehrung_zeit,
  drop column if exists zeit_hinweis_start,
  drop column if exists zeit_hinweis_ziel,
  drop column if exists zeit_hinweis_rueckfuehrung;

-- ------------------------------------------------------------
-- 2. Kundensicht — neue Zeitfelder + km, damit der Auftraggeber die
--    Werte sieht, die er selbst pflegen darf.
--    Preisfelder (verguetung, fahrer_honorar, barauslagen, fahrer_id)
--    stehen hier bewusst WEITERHIN NICHT drin (H-1).
-- ------------------------------------------------------------
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
  zeit_start           text,
  zeit_ziel            text,
  zeit_rueckfuehrung   text,
  km_hin               integer,
  km_rueck             integer,
  km_gesamt            integer,
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
    t.fahrzeugmodell,
    t.zeit_start, t.zeit_ziel, t.zeit_rueckfuehrung,
    t.km_hin, t.km_rueck, t.km_gesamt,
    t.adresse_start, t.adresse_ziel, t.adresse_rueckfuehrung,
    t.kontakt_start, t.kontakt_ziel, t.kontakt_rueckfuehrung,
    t.protokoll_art, t.info,
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

drop policy if exists touren_auftraggeber_read on public.touren;

-- ------------------------------------------------------------
-- 3. Whitelist: Zeitfelder ersetzt, km ergänzt.
--    Die geschützten Spalten bleiben unverändert draußen.
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
  c_whitelist constant text[] := array[
    'start_stadt', 'ziel_stadt', 'rueckfuehrung_stadt',
    'adresse_start', 'adresse_ziel', 'adresse_rueckfuehrung',
    'kontakt_start', 'kontakt_ziel', 'kontakt_rueckfuehrung',
    'kennzeichen', 'fin', 'fin_rueck', 'kundenname',
    'startdatum', 'enddatum', 'tourenart', 'ist_e_fahrzeug', 'info',
    'fahrzeugmodell',
    -- 081: Zeitangaben als Freitext je Station
    'zeit_start', 'zeit_ziel', 'zeit_rueckfuehrung',
    -- 081: km darf der Auftraggeber pflegen. Der PREIS bleibt gesperrt —
    -- der Admin sieht die Änderung im Protokoll und passt ihn bei Bedarf
    -- selbst an.
    'km_hin', 'km_rueck', 'km_gesamt'
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

  -- FESTE Spaltenliste. verguetung, fahrer_id, fahrer_honorar,
  -- barauslagen, bestaetigt, abgelehnt, auftraggeber_id und tour_id
  -- kommen hier bewusst NICHT vor.
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
    info                  = v_neu.info,
    fahrzeugmodell        = v_neu.fahrzeugmodell,
    zeit_start            = v_neu.zeit_start,
    zeit_ziel             = v_neu.zeit_ziel,
    zeit_rueckfuehrung    = v_neu.zeit_rueckfuehrung,
    km_hin                = v_neu.km_hin,
    km_rueck              = v_neu.km_rueck,
    km_gesamt             = v_neu.km_gesamt
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

-- ------------------------------------------------------------
-- 4. routen_cache für Auftraggeber öffnen (lesen + anlegen).
--    Inhalt ist reine Adress-/Distanz-Information; der Google-Key
--    bleibt serverseitig und der Endpoint bleibt authentifiziert.
-- ------------------------------------------------------------
drop policy if exists routen_cache_auftraggeber on public.routen_cache;
create policy routen_cache_auftraggeber on public.routen_cache
  for select using (public.is_auftraggeber());

drop policy if exists routen_cache_auftraggeber_insert on public.routen_cache;
create policy routen_cache_auftraggeber_insert on public.routen_cache
  for insert with check (public.is_auftraggeber());

grant select, insert on public.routen_cache to authenticated;

notify pgrst, 'reload schema';
