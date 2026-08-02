-- ============================================================
-- Maja-Logistik Business-Portal — 080: Fahrzeugmodell,
-- Abhol-/Abgabezeiten und mehrere Ansprechpartner pro Station
-- ------------------------------------------------------------
-- Drei fachliche Ergänzungen an der Tour:
--
--   1. fahrzeugmodell (text, optional) — "VW Polo", "Mercedes GLE".
--   2. Zeiten je Station: abholzeit / abgabezeit / rueckfuehrung_zeit
--      als `time`, damit sie maschinell auswertbar bleiben. Für
--      Angaben wie "vormittags" oder "nach Absprache" gibt es je
--      Station ein eigenes Freitextfeld zeit_hinweis_*.
--   3. tour_ansprechpartner: mehrere Kontakte je Station.
--
-- Zu (3) — Umgang mit den bestehenden kontakt_*-Spalten:
--   Die neue Tabelle ist die Quelle der Wahrheit. Die alten jsonb-
--   Spalten touren.kontakt_start / _ziel / _rueckfuehrung BLEIBEN und
--   werden per Trigger als Spiegel des jeweils ERSTEN Ansprechpartners
--   fortgeschrieben. Damit funktionieren bestehende PDF-Mappings,
--   Exporte und Anzeigen unverändert weiter, ohne dass sie angefasst
--   werden müssen. Ein späterer Umbau kann sie entfernen — nicht hier.
--   Die vorhandenen Werte werden unten in die Tabelle übernommen.
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Neue Tour-Spalten
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists fahrzeugmodell             text,
  add column if not exists abholzeit                  time,
  add column if not exists abgabezeit                 time,
  add column if not exists rueckfuehrung_zeit         time,
  add column if not exists zeit_hinweis_start         text,
  add column if not exists zeit_hinweis_ziel          text,
  add column if not exists zeit_hinweis_rueckfuehrung text;

comment on column public.touren.fahrzeugmodell is
  'Fahrzeugmodell, z.B. "VW Polo". Optional.';
comment on column public.touren.abholzeit is
  'Uhrzeit der Abholung an der Startstation. Optional; für unscharfe '
  'Angaben ("vormittags") gibt es zeit_hinweis_start.';

-- ------------------------------------------------------------
-- 2. Ansprechpartner je Station
-- ------------------------------------------------------------
create table if not exists public.tour_ansprechpartner (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.touren(id) on delete cascade,
  station     text not null check (station in ('start', 'ziel', 'rueckfuehrung')),
  name        text,
  telefon     text,
  email       text,
  sortierung  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tour_ansprechpartner_tour
  on public.tour_ansprechpartner(tour_id, station, sortierung);

comment on table public.tour_ansprechpartner is
  'Ansprechpartner je Station einer Tour (start|ziel|rueckfuehrung). '
  'Der erste Eintrag (kleinste sortierung) wird per Trigger in die '
  'Alt-Spalten touren.kontakt_* gespiegelt, damit bestehende Mappings, '
  'Exporte und Anzeigen unverändert funktionieren.';

alter table public.tour_ansprechpartner enable row level security;

-- Sichtbarkeit exakt wie bei der zugehörigen Tour. Keine Preis- oder
-- Fahrerdaten betroffen, daher ist das unkritisch.
drop policy if exists tap_admin_all on public.tour_ansprechpartner;
create policy tap_admin_all on public.tour_ansprechpartner
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tap_fahrer_read on public.tour_ansprechpartner;
create policy tap_fahrer_read on public.tour_ansprechpartner
  for select using (public.tour_gehoert_meinem_fahrer(tour_id));

drop policy if exists tap_auftraggeber_read on public.tour_ansprechpartner;
create policy tap_auftraggeber_read on public.tour_ansprechpartner
  for select using (
    public.is_auftraggeber() and public.tour_ist_von_meinem_ag(tour_id)
  );

drop policy if exists tap_test_read on public.tour_ansprechpartner;
create policy tap_test_read on public.tour_ansprechpartner
  for select using (public.is_test());

-- Schreiben dürfen Auftraggeber NICHT direkt — dafür gibt es die RPC
-- weiter unten (analog zu ag_tour_aktualisieren).
grant select, insert, update, delete on public.tour_ansprechpartner to authenticated;

-- ------------------------------------------------------------
-- 3. Spiegel-Trigger: erster Ansprechpartner → touren.kontakt_*
-- ------------------------------------------------------------
create or replace function public.tour_kontakt_spiegeln()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tour    uuid;
  v_station text;
  v_erster  public.tour_ansprechpartner%rowtype;
  v_json    jsonb;
begin
  v_tour    := coalesce(new.tour_id, old.tour_id);
  v_station := coalesce(new.station, old.station);

  select * into v_erster
    from public.tour_ansprechpartner
   where tour_id = v_tour and station = v_station
   order by sortierung, created_at
   limit 1;

  if found then
    v_json := jsonb_build_object(
      'name',    coalesce(v_erster.name, ''),
      'telefon', coalesce(v_erster.telefon, ''),
      'email',   coalesce(v_erster.email, '')
    );
  else
    v_json := null;
  end if;

  if v_station = 'start' then
    update public.touren set kontakt_start = v_json where id = v_tour;
  elsif v_station = 'ziel' then
    update public.touren set kontakt_ziel = v_json where id = v_tour;
  else
    update public.touren set kontakt_rueckfuehrung = v_json where id = v_tour;
  end if;

  return null;
end;
$$;

drop trigger if exists tour_ansprechpartner_spiegel on public.tour_ansprechpartner;
create trigger tour_ansprechpartner_spiegel
  after insert or update or delete on public.tour_ansprechpartner
  for each row execute function public.tour_kontakt_spiegeln();

-- ------------------------------------------------------------
-- 4. Bestandsdaten übernehmen: vorhandene kontakt_*-Werte werden zum
--    jeweils ERSTEN Ansprechpartner. Nur einmal — Touren, die bereits
--    Einträge haben, werden übersprungen.
-- ------------------------------------------------------------
do $migration$
declare
  v_station text;
  v_spalte  text;
begin
  foreach v_station in array array['start', 'ziel', 'rueckfuehrung'] loop
    v_spalte := 'kontakt_' || case when v_station = 'rueckfuehrung'
                                   then 'rueckfuehrung' else v_station end;
    execute format($sql$
      insert into public.tour_ansprechpartner (tour_id, station, name, telefon, email, sortierung)
      select t.id, %L,
             nullif(btrim(coalesce(t.%I ->> 'name', '')), ''),
             nullif(btrim(coalesce(t.%I ->> 'telefon', '')), ''),
             nullif(btrim(coalesce(t.%I ->> 'email', '')), ''),
             0
        from public.touren t
       where t.%I is not null
         and coalesce(
               btrim(coalesce(t.%I ->> 'name', ''))
               || btrim(coalesce(t.%I ->> 'telefon', ''))
               || btrim(coalesce(t.%I ->> 'email', '')), '') <> ''
         and not exists (
               select 1 from public.tour_ansprechpartner a
                where a.tour_id = t.id and a.station = %L
             )
    $sql$, v_station, v_spalte, v_spalte, v_spalte, v_spalte,
           v_spalte, v_spalte, v_spalte, v_station);
  end loop;
end
$migration$;

-- ------------------------------------------------------------
-- 5. Kundensicht um die neuen Felder erweitern (Definition wie 079
--    plus fahrzeugmodell und die Zeitfelder).
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
  abholzeit            time,
  abgabezeit           time,
  rueckfuehrung_zeit   time,
  zeit_hinweis_start   text,
  zeit_hinweis_ziel    text,
  zeit_hinweis_rueckfuehrung text,
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
    t.abholzeit, t.abgabezeit, t.rueckfuehrung_zeit,
    t.zeit_hinweis_start, t.zeit_hinweis_ziel, t.zeit_hinweis_rueckfuehrung,
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
-- 6. Auftraggeber-Whitelist erweitern.
--    Identisch zu 079, nur die Feldliste und das SET wachsen um die
--    neuen Spalten. Die geschützten Spalten (verguetung, fahrer_id,
--    fahrer_honorar, barauslagen, km_*, bestaetigt, …) bleiben
--    unverändert draußen.
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
    -- Neu (080):
    'fahrzeugmodell',
    'abholzeit', 'abgabezeit', 'rueckfuehrung_zeit',
    'zeit_hinweis_start', 'zeit_hinweis_ziel', 'zeit_hinweis_rueckfuehrung'
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

  -- FESTE Spaltenliste; geschützte Spalten stehen bewusst nicht drin.
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
    abholzeit             = v_neu.abholzeit,
    abgabezeit            = v_neu.abgabezeit,
    rueckfuehrung_zeit    = v_neu.rueckfuehrung_zeit,
    zeit_hinweis_start    = v_neu.zeit_hinweis_start,
    zeit_hinweis_ziel     = v_neu.zeit_hinweis_ziel,
    zeit_hinweis_rueckfuehrung = v_neu.zeit_hinweis_rueckfuehrung
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
-- 7. Ansprechpartner durch den Auftraggeber pflegen.
--
-- p_liste ist die VOLLSTÄNDIGE neue Liste einer Station:
--   [{"name":…,"telefon":…,"email":…}, …]
-- Die Reihenfolge im Array bestimmt die Sortierung. Geprüft werden
-- dieselben Bedingungen wie bei ag_tour_aktualisieren (eigene Tour,
-- nicht abgelehnt, nicht abgerechnet). Änderungen landen im
-- Protokoll — in lesbarer Form ("Ansprechpartner Ziel").
-- ------------------------------------------------------------
-- Lesbare Zusammenfassung aller Ansprechpartner einer Station — für das
-- Änderungsprotokoll ("Max Mustermann (0123) | Erika Muster").
create or replace function public.tour_ansprechpartner_text(
  p_tour_id uuid, p_station text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(string_agg(
    concat_ws(' ',
      nullif(btrim(coalesce(a.name, '')), ''),
      case when nullif(btrim(coalesce(a.telefon, '')), '') is not null
           then '(' || btrim(a.telefon) || ')' end,
      nullif(btrim(coalesce(a.email, '')), '')
    ), ' | ' order by a.sortierung, a.created_at
  ), '')
  from public.tour_ansprechpartner a
  where a.tour_id = p_tour_id and a.station = p_station;
$$;

create or replace function public.ag_tour_ansprechpartner_setzen(
  p_tour_id uuid,
  p_station text,
  p_liste   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag      uuid;
  v_tour    public.touren%rowtype;
  v_alt_txt text;
  v_neu_txt text;
  v_label   text;
  v_eintrag jsonb;
  v_idx     int := 0;
  v_name    text;
  v_tel     text;
  v_mail    text;
begin
  if not public.is_auftraggeber() then
    return jsonb_build_object('ok', false, 'fehler', 'Nur für Auftraggeber-Profile.');
  end if;
  if p_station not in ('start', 'ziel', 'rueckfuehrung') then
    return jsonb_build_object('ok', false, 'fehler', 'Unbekannte Station.');
  end if;
  v_ag := public.current_auftraggeber_id();
  if v_ag is null then
    return jsonb_build_object('ok', false, 'fehler', 'Ihrem Konto ist kein Auftraggeber zugeordnet.');
  end if;

  select * into v_tour from public.touren where id = p_tour_id;
  if not found or v_tour.auftraggeber_id is distinct from v_ag then
    return jsonb_build_object('ok', false, 'fehler', 'Tour nicht gefunden.');
  end if;
  if v_tour.abgelehnt then
    return jsonb_build_object('ok', false, 'fehler', 'Abgelehnte Touren können nicht bearbeitet werden.');
  end if;
  if public.tour_ist_abgerechnet(p_tour_id) then
    return jsonb_build_object(
      'ok', false,
      'fehler', 'Diese Tour wurde bereits abgerechnet. Bitte wenden Sie sich an Maja-Logistik.'
    );
  end if;

  v_alt_txt := public.tour_ansprechpartner_text(p_tour_id, p_station);

  delete from public.tour_ansprechpartner
   where tour_id = p_tour_id and station = p_station;

  if p_liste is not null and jsonb_typeof(p_liste) = 'array' then
    for v_eintrag in select * from jsonb_array_elements(p_liste) loop
      v_name := nullif(btrim(coalesce(v_eintrag ->> 'name', '')), '');
      v_tel  := nullif(btrim(coalesce(v_eintrag ->> 'telefon', '')), '');
      v_mail := nullif(btrim(coalesce(v_eintrag ->> 'email', '')), '');
      -- Komplett leere Blöcke nicht speichern.
      if v_name is null and v_tel is null and v_mail is null then continue; end if;
      insert into public.tour_ansprechpartner (tour_id, station, name, telefon, email, sortierung)
      values (p_tour_id, p_station, v_name, v_tel, v_mail, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  v_neu_txt := public.tour_ansprechpartner_text(p_tour_id, p_station);

  if v_alt_txt is distinct from v_neu_txt then
    v_label := 'ansprechpartner_' || p_station;
    insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu)
    values (p_tour_id, auth.uid(), v_label, v_alt_txt, v_neu_txt);
    return jsonb_build_object(
      'ok', true, 'geaendert', true,
      'bestaetigt', v_tour.bestaetigt,
      'alt', v_alt_txt, 'neu', v_neu_txt
    );
  end if;

  return jsonb_build_object('ok', true, 'geaendert', false,
                            'bestaetigt', v_tour.bestaetigt);
end;
$$;

revoke all on function public.tour_ansprechpartner_text(uuid, text) from public;
revoke all on function public.ag_tour_ansprechpartner_setzen(uuid, text, jsonb) from public;
grant execute on function public.tour_ansprechpartner_text(uuid, text) to authenticated;
grant execute on function public.ag_tour_ansprechpartner_setzen(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
