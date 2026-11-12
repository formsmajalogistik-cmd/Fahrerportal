-- Niederlassungen eines Auftraggebers (Migration 118).
--
-- Ein Auftraggeber kann weitere Standorte haben: gleicher Name, andere
-- Adresse, i.d.R. gleiche Rechnungs-E-Mail. Der bisherige Auftraggeber-
-- Datensatz ist der HAUPTSITZ; weitere Standorte stehen in
-- auftraggeber_niederlassungen. Touren, Rechnungen und Gutschriften
-- bekommen ein optionales niederlassung_id — leer = Hauptsitz.
--
-- Additiv und idempotent:
--   * bestehende Touren, Rechnungen, Gutschriften, E-Rechnungen bleiben
--     unverändert (niederlassung_id bleibt leer = Hauptsitz);
--   * gesperrte Belege (116) bleiben gesperrt — die neue Spalte ist nicht
--     in der Liste der freien Felder;
--   * vom Auftraggeber geerbt (nicht je Niederlassung): Name, Preisliste,
--     Auslagen-Preise, Zahlungsziel, Rechnungsformat, E-Rechnungs-Format,
--     USt-IdNr.
--
-- Je Niederlassung abweichend möglich (leer = vom Auftraggeber):
-- Rechnungs-E-Mail, E-Rechnungs-Adresse, Käuferreferenz, Kundennummer,
-- Ansprechpartner.
--
-- Serverseitige Regeln (Trigger niederlassung_pruefen):
--   * die Niederlassung muss zum Auftraggeber des Datensatzes gehören;
--   * eine INAKTIVE Niederlassung kann nicht neu zugewiesen werden
--     (bestehende Zuordnungen bleiben und werden weiter angezeigt);
--   * an einer Tour, die auf einer erstellten Rechnung steht (offen /
--     bezahlt), ist die Niederlassung nicht mehr änderbar;
--   * Löschen nur ohne Touren/Rechnungen/Gutschriften (Fremdschlüssel
--     „restrict") — sonst deaktivieren.

-- ------------------------------------------------------------
-- 1. Hauptsitz: Bezeichnung (leer = Ort des Auftraggebers)
-- ------------------------------------------------------------
alter table public.auftraggeber add column if not exists hauptsitz_bezeichnung text;
comment on column public.auftraggeber.hauptsitz_bezeichnung is
  'Anzeige des Hauptsitzes in „Name · Bezeichnung", sobald es Niederlassungen gibt. Leer = Ort.';

-- ------------------------------------------------------------
-- 2. Niederlassungen
-- ------------------------------------------------------------
create table if not exists public.auftraggeber_niederlassungen (
  id               uuid primary key default gen_random_uuid(),
  auftraggeber_id  uuid not null references public.auftraggeber(id) on delete cascade,
  bezeichnung      text not null,
  strasse          text,
  plz              text,
  ort              text,
  land_code        text default 'DE',
  -- leer = Wert des Auftraggebers
  rechnungs_email  text,
  erechnung_email  text,
  kaeufer_referenz text,
  kundennummer     text,
  ansprechpartner  text,
  aktiv            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.auftraggeber_niederlassungen drop constraint if exists auftraggeber_niederlassungen_bezeichnung_check;
alter table public.auftraggeber_niederlassungen add constraint auftraggeber_niederlassungen_bezeichnung_check
  check (btrim(bezeichnung) <> '');
alter table public.auftraggeber_niederlassungen drop constraint if exists auftraggeber_niederlassungen_land_code_check;
alter table public.auftraggeber_niederlassungen add constraint auftraggeber_niederlassungen_land_code_check
  check (land_code is null or land_code ~ '^[A-Z]{2}$');
create unique index if not exists auftraggeber_niederlassungen_bezeichnung_eindeutig
  on public.auftraggeber_niederlassungen (auftraggeber_id, lower(btrim(bezeichnung)));
create index if not exists idx_auftraggeber_niederlassungen_ag
  on public.auftraggeber_niederlassungen (auftraggeber_id);
comment on table public.auftraggeber_niederlassungen is
  'Weitere Standorte eines Auftraggebers (der Auftraggeber selbst ist der Hauptsitz). Migration 118.';

drop trigger if exists auftraggeber_niederlassungen_touch on public.auftraggeber_niederlassungen;
create trigger auftraggeber_niederlassungen_touch
  before update on public.auftraggeber_niederlassungen
  for each row execute function public.touch_updated_at();

-- RLS wie beim Auftraggeber: Auftraggeber-Konten sehen nur die eigenen,
-- alle anderen Rollen lesen; schreiben nur Admins.
alter table public.auftraggeber_niederlassungen enable row level security;
drop policy if exists niederlassungen_read on public.auftraggeber_niederlassungen;
create policy niederlassungen_read on public.auftraggeber_niederlassungen
  for select using (
    (auth.role() = 'authenticated' and not public.is_auftraggeber())
    or auftraggeber_id = public.current_auftraggeber_id()
  );
drop policy if exists niederlassungen_admin_write on public.auftraggeber_niederlassungen;
create policy niederlassungen_admin_write on public.auftraggeber_niederlassungen
  for all using (public.is_admin() and not public.is_test())
  with check (public.is_admin() and not public.is_test());
grant select, insert, update, delete on public.auftraggeber_niederlassungen to authenticated;

-- ------------------------------------------------------------
-- 3. Zuordnung an Touren, Rechnungen, Gutschriften (leer = Hauptsitz)
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists niederlassung_id uuid references public.auftraggeber_niederlassungen(id) on delete restrict;
alter table public.rechnungen
  add column if not exists niederlassung_id uuid references public.auftraggeber_niederlassungen(id) on delete restrict;
alter table public.gutschriften
  add column if not exists niederlassung_id uuid references public.auftraggeber_niederlassungen(id) on delete restrict;
create index if not exists idx_touren_niederlassung on public.touren (niederlassung_id) where niederlassung_id is not null;
create index if not exists idx_rechnungen_niederlassung on public.rechnungen (niederlassung_id) where niederlassung_id is not null;
create index if not exists idx_gutschriften_niederlassung on public.gutschriften (niederlassung_id) where niederlassung_id is not null;

-- ------------------------------------------------------------
-- 4. Prüfung beim Schreiben
-- ------------------------------------------------------------
create or replace function public.niederlassung_pruefen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n   record;
  v_neu boolean;
begin
  -- Storno/Teilgutschrift: Niederlassung der Originalrechnung übernehmen.
  -- (verschachtelt: rechnung_id/art gibt es nur in gutschriften)
  if tg_table_name = 'gutschriften' and tg_op = 'INSERT' and new.niederlassung_id is null then
    if new.rechnung_id is not null and new.art in ('storno', 'teilgutschrift') then
      select r.niederlassung_id into new.niederlassung_id from rechnungen r where r.id = new.rechnung_id;
    end if;
  end if;

  if new.niederlassung_id is not null then
    select n.auftraggeber_id, n.aktiv into v_n from auftraggeber_niederlassungen n where n.id = new.niederlassung_id;
    if new.auftraggeber_id is distinct from v_n.auftraggeber_id then
      raise exception 'NIEDERLASSUNG_FREMD: Die Niederlassung gehört nicht zu diesem Auftraggeber.'
        using errcode = '23514';
    end if;
    v_neu := tg_op = 'INSERT' or new.niederlassung_id is distinct from old.niederlassung_id;
    -- Inaktive Niederlassungen nicht neu zuweisen (Gutschriften übernehmen
    -- die Niederlassung ihrer Rechnung — dort keine Sperre).
    if v_neu and not v_n.aktiv and tg_table_name <> 'gutschriften' then
      raise exception 'NIEDERLASSUNG_INAKTIV: Diese Niederlassung ist inaktiv und kann nicht mehr zugewiesen werden.'
        using errcode = '23514';
    end if;
  end if;

  -- Touren auf einer erstellten Rechnung: Niederlassung bleibt.
  if tg_table_name = 'touren' and tg_op = 'UPDATE'
     and new.niederlassung_id is distinct from old.niederlassung_id
     and exists (select 1 from rechnungspositionen rp join rechnungen r on r.id = rp.rechnung_id
                  where rp.tour_id = new.id and r.status in ('offen', 'bezahlt')) then
    raise exception 'NIEDERLASSUNG_ABGERECHNET: Die Tour steht auf einer erstellten Rechnung — die Niederlassung ist nicht mehr änderbar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists touren_niederlassung_pruefen on public.touren;
create trigger touren_niederlassung_pruefen
  before insert or update of niederlassung_id, auftraggeber_id on public.touren
  for each row execute function public.niederlassung_pruefen();
drop trigger if exists rechnungen_niederlassung_pruefen on public.rechnungen;
create trigger rechnungen_niederlassung_pruefen
  before insert or update of niederlassung_id, auftraggeber_id on public.rechnungen
  for each row execute function public.niederlassung_pruefen();
drop trigger if exists gutschriften_niederlassung_pruefen on public.gutschriften;
create trigger gutschriften_niederlassung_pruefen
  before insert or update of niederlassung_id, auftraggeber_id on public.gutschriften
  for each row execute function public.niederlassung_pruefen();

-- ------------------------------------------------------------
-- 5. Beim Erstellen einer Rechnung: E-Rechnungs-Adresse und
--    Käuferreferenz der Niederlassung, sonst des Auftraggebers.
--    Ohne Niederlassung exakt wie 116.
-- ------------------------------------------------------------
create or replace function public.rechnung_beim_erstellen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ag     record;
  v_n_mail text;  -- E-Rechnungs-Adresse der Niederlassung (leer = Auftraggeber)
  v_n_ref  text;  -- Käuferreferenz der Niederlassung (leer = Auftraggeber)
begin
  if new.status = 'entwurf' then return new; end if;
  if tg_op = 'UPDATE' and old.status is distinct from 'entwurf' then return new; end if;
  new.absender_snapshot := (select value from app_settings where key = 'firmendaten');
  if new.empfaenger_typ is distinct from 'manuell' and new.auftraggeber_id is not null then
    select a.erechnung_format, a.erechnung_email, a.kaeufer_referenz into v_ag
      from auftraggeber a where a.id = new.auftraggeber_id;
    if new.niederlassung_id is not null then
      select nullif(btrim(n.erechnung_email), ''), nullif(btrim(n.kaeufer_referenz), '')
        into v_n_mail, v_n_ref from auftraggeber_niederlassungen n where n.id = new.niederlassung_id;
    end if;
    new.erechnung_format := coalesce(v_ag.erechnung_format, 'pdf');
    new.erechnung_email  := coalesce(new.erechnung_email, v_n_mail, v_ag.erechnung_email);
    new.kaeufer_referenz := coalesce(new.kaeufer_referenz, v_n_ref, v_ag.kaeufer_referenz);
  else
    new.erechnung_format := coalesce(new.erechnung_format, 'pdf');
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 6. Ein Auftraggeber mit Niederlassungen: Anzeige „Name · Ort"
--    (für Server/Views; der Client nutzt lib/niederlassungen.ts).
-- ------------------------------------------------------------
create or replace function public.auftraggeber_anzeige(p_auftraggeber_id uuid, p_niederlassung_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from auftraggeber_niederlassungen n where n.auftraggeber_id = a.id) then a.name
    when p_niederlassung_id is null then a.name || ' · ' || coalesce(nullif(btrim(a.hauptsitz_bezeichnung), ''), nullif(btrim(a.ort), ''), 'Hauptsitz')
    else a.name || ' · ' || (select n.bezeichnung from auftraggeber_niederlassungen n where n.id = p_niederlassung_id)
  end
  from auftraggeber a where a.id = p_auftraggeber_id;
$$;
revoke all on function public.auftraggeber_anzeige(uuid, uuid) from public;
grant execute on function public.auftraggeber_anzeige(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. Auftraggeber-Konten: Niederlassung beim Anlegen/Bearbeiten
--    (Whitelist + feste Spaltenlisten aus 087, je um niederlassung_id
--    ergänzt — sonst wortgleich).
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
    'auf_eis','auf_eis_notiz',
    'niederlassung_id'
  ]::text[];
$$;

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
    niederlassung_id,
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
    -- Niederlassung (Migration 118): gehört sie nicht zu v_ag, lehnt der
    -- Trigger niederlassung_pruefen ab.
    v_neu.niederlassung_id,
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
    niederlassung_id      = v_neu.niederlassung_id,
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

-- ------------------------------------------------------------
-- 8. Kundensicht: Niederlassung ergänzen (ohne Preise; sonst wie 087)
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
  abgerechnet          boolean,
  niederlassung_id     uuid
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
      as abgerechnet,
    t.niederlassung_id
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

notify pgrst, 'reload schema';
