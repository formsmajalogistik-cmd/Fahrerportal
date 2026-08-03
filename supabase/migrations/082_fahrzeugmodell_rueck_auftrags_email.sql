-- ============================================================
-- Maja-Logistik Business-Portal — 082: Fahrzeugmodell Rück +
-- Auftrags-E-Mail an den Fahrer
-- ------------------------------------------------------------
-- 1. fahrzeugmodell_rueck (text, nullable) — analog zu kennzeichen[1]
--    und fin_rueck. Nur relevant, wenn die Tour eine Rückfahrt hat
--    (ABA/ABC); die Sichtbarkeit steuert das Frontend.
--
-- 2. auftrag_versendet_am — Zeitstempel des letzten Auftrags-Versands
--    an den Fahrer, analog zu rechnungen.email_versendet_am.
--
-- 3. Vorlage für die Auftrags-E-Mail in app_settings. Der Default-Text
--    ist bewusst vollständig, damit der Button sofort nutzbar ist.
--    WICHTIG: die Auftraggeber-Vergütung ist KEIN Platzhalter — der
--    Fahrer bekommt sie nicht zu sehen. {fahrer_honorar} ist erlaubt.
--
-- Idempotent.
-- ============================================================

alter table public.touren
  add column if not exists fahrzeugmodell_rueck text,
  add column if not exists auftrag_versendet_am timestamptz;

comment on column public.touren.fahrzeugmodell_rueck is
  'Fahrzeugmodell des Rückfahrzeugs. Nur bei ABA/ABC relevant.';
comment on column public.touren.auftrag_versendet_am is
  'Letzter Versand des Auftrags per E-Mail an den Fahrer.';

-- ------------------------------------------------------------
-- Kundensicht: fahrzeugmodell_rueck ergänzen. Definition wie 081,
-- Preisfelder bleiben weiterhin draußen (H-1).
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
    t.fahrzeugmodell, t.fahrzeugmodell_rueck,
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
-- Whitelist um fahrzeugmodell_rueck erweitern. Alles andere wie 081;
-- die Preis-/Fahrer-Spalten bleiben unverändert draußen.
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
    'fahrzeugmodell', 'fahrzeugmodell_rueck',
    'zeit_start', 'zeit_ziel', 'zeit_rueckfuehrung',
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
    fahrzeugmodell_rueck  = v_neu.fahrzeugmodell_rueck,
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
-- Vorlage für die Auftrags-E-Mail (Admin-only wie alle app_settings).
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
values (
  'auftrags_email',
  jsonb_build_object(
    'from', 'mail_inbox_1',
    'subject', 'Fahrauftrag {tour_id} — {stadt_start} nach {stadt_ziel} am {startdatum}',
    'body',
      E'Hallo {fahrer_name},\n'
      || E'\n'
      || E'anbei dein Fahrauftrag:\n'
      || E'\n'
      || E'Auftrag: {tour_id}\n'
      || E'Auftraggeber: {auftraggeber}\n'
      || E'Kunde: {kundenname}\n'
      || E'Tourenart: {tourenart}\n'
      || E'\n'
      || E'FAHRZEUG\n'
      || E'Kennzeichen: {kennzeichen}\n'
      || E'Modell: {fahrzeugmodell}\n'
      || E'FIN: {fin}\n'
      || E'Kennzeichen Rück: {kennzeichen_rueck}\n'
      || E'Modell Rück: {fahrzeugmodell_rueck}\n'
      || E'FIN Rück: {fin_rueck}\n'
      || E'\n'
      || E'ABHOLUNG — {stadt_start}, {startdatum}\n'
      || E'Zeit: {zeit_start}\n'
      || E'Adresse: {adresse_start}\n'
      || E'Ansprechpartner: {kontakt_start}\n'
      || E'\n'
      || E'ABGABE — {stadt_ziel}, {enddatum}\n'
      || E'Zeit: {zeit_ziel}\n'
      || E'Adresse: {adresse_ziel}\n'
      || E'Ansprechpartner: {kontakt_ziel}\n'
      || E'\n'
      || E'RÜCKFÜHRUNG — {stadt_rueckfuehrung}\n'
      || E'Zeit: {zeit_rueckfuehrung}\n'
      || E'Adresse: {adresse_rueckfuehrung}\n'
      || E'Ansprechpartner: {kontakt_rueckfuehrung}\n'
      || E'\n'
      || E'Hinweise: {info}\n'
      || E'Honorar: {fahrer_honorar}\n'
      || E'\n'
      || E'Bitte kurz bestätigen. Danke!'
  )
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
