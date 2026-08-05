-- ============================================================
-- Maja-Logistik Business-Portal — 084: Tour-Anlage durch
-- Auftraggeber über eine zentrale Whitelist-Funktion
-- ------------------------------------------------------------
-- Auslöser: "new row violates row-level security policy for table
-- touren" beim Einreichen einer ABA-Tour durch ein Auftraggeber-Profil.
--
-- Die INSERT-Policy aus 056 prüft NICHT die Tourenart, sondern nur:
--   is_auftraggeber(), auftraggeber_id = current_auftraggeber_id(),
--   bestaetigt = false, erstellt_von = auth.uid(),
--   fahrer_id is null, verguetung is null,
--   coalesce(barauslagen,0) = 0, coalesce(fahrer_honorar,0) = 0
--
-- Ein direkter Insert mit dem aktuellen Frontend-Payload erfüllt diese
-- Bedingungen für AB, ABA UND ABC gleichermaßen (lokal nachgestellt).
-- Welche Bedingung in der laufenden Datenbank kippt, lässt sich von
-- außen nicht feststellen — es genügt aber, dass EINE der Bedingungen
-- vom Payload abhängt, damit ein vergessenes oder falsch belegtes Feld
-- den ganzen Insert killt.
--
-- Deshalb hier der strukturelle Fix: Auftraggeber legen Touren ab jetzt
-- über eine SECURITY-DEFINER-Funktion an, die
--   * die erlaubten Spalten ZENTRAL aus ag_tour_felder() nimmt —
--     dieselbe Liste, die auch ag_tour_aktualisieren() verwendet, damit
--     Anlegen und Bearbeiten nie wieder auseinanderlaufen,
--   * auftraggeber_id, erstellt_von, erstellt_von_rolle und bestaetigt
--     SERVERSEITIG setzt statt sie aus dem Payload zu übernehmen —
--     eine fremde Tour lässt sich damit gar nicht mehr anlegen,
--   * die geschützten Spalten (verguetung, fahrer_id, fahrer_honorar,
--     barauslagen, km-Preisfelder …) nie schreibt.
--
-- Die Policy aus 056 bleibt unverändert bestehen und sichert weiterhin
-- jeden direkten Insert ab.
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Zentrale Whitelist — eine Quelle für Anlegen UND Bearbeiten.
-- ------------------------------------------------------------
create or replace function public.ag_tour_felder()
returns text[]
language sql
immutable
as $$
  select array[
    'start_stadt', 'ziel_stadt', 'rueckfuehrung_stadt',
    'adresse_start', 'adresse_ziel', 'adresse_rueckfuehrung',
    'kontakt_start', 'kontakt_ziel', 'kontakt_rueckfuehrung',
    'kennzeichen', 'fin', 'fin_rueck', 'kundenname',
    'startdatum', 'enddatum', 'tourenart', 'ist_e_fahrzeug', 'info',
    'fahrzeugmodell', 'fahrzeugmodell_rueck',
    'zeit_start', 'zeit_ziel', 'zeit_rueckfuehrung',
    'km_hin', 'km_rueck', 'km_gesamt',
    'protokoll_art'
  ]::text[];
$$;

comment on function public.ag_tour_felder() is
  'Spalten, die ein Auftraggeber an seinen eigenen Touren setzen darf. '
  'Wird von ag_tour_anlegen() und ag_tour_aktualisieren() gemeinsam '
  'genutzt — Preis-, Fahrer- und Status-Spalten stehen bewusst nicht '
  'drin und können deshalb über keinen der beiden Wege gesetzt werden.';

grant execute on function public.ag_tour_felder() to authenticated;

-- ------------------------------------------------------------
-- 2. Anlegen
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
  if v_neu.startdatum is null or v_neu.enddatum is null then
    return jsonb_build_object('ok', false, 'fehler', 'Start- und Enddatum sind Pflichtfelder.');
  end if;

  -- FESTE Spaltenliste. Die Kopfdaten setzt der Server, NICHT der Client.
  insert into public.touren (
    start_stadt, ziel_stadt, rueckfuehrung_stadt,
    adresse_start, adresse_ziel, adresse_rueckfuehrung,
    kontakt_start, kontakt_ziel, kontakt_rueckfuehrung,
    kennzeichen, fin, fin_rueck, kundenname,
    startdatum, enddatum, tourenart, ist_e_fahrzeug, info,
    fahrzeugmodell, fahrzeugmodell_rueck,
    zeit_start, zeit_ziel, zeit_rueckfuehrung,
    km_hin, km_rueck, km_gesamt, protokoll_art,
    auftraggeber_id, bestaetigt, erstellt_von, erstellt_von_rolle
  ) values (
    btrim(v_neu.start_stadt), btrim(v_neu.ziel_stadt), v_neu.rueckfuehrung_stadt,
    v_neu.adresse_start, v_neu.adresse_ziel, v_neu.adresse_rueckfuehrung,
    v_neu.kontakt_start, v_neu.kontakt_ziel, v_neu.kontakt_rueckfuehrung,
    coalesce(v_neu.kennzeichen, '{}'), v_neu.fin, v_neu.fin_rueck, v_neu.kundenname,
    v_neu.startdatum, v_neu.enddatum, v_neu.tourenart,
    coalesce(v_neu.ist_e_fahrzeug, false), v_neu.info,
    v_neu.fahrzeugmodell, v_neu.fahrzeugmodell_rueck,
    v_neu.zeit_start, v_neu.zeit_ziel, v_neu.zeit_rueckfuehrung,
    v_neu.km_hin, v_neu.km_rueck, v_neu.km_gesamt, v_neu.protokoll_art,
    -- Serverseitig gesetzt — nicht aus dem Payload:
    v_ag, false, auth.uid(), 'auftraggeber'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.ag_tour_anlegen(jsonb) from public;
grant execute on function public.ag_tour_anlegen(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. ag_tour_aktualisieren auf dieselbe Whitelist umstellen, damit
--    Anlegen und Bearbeiten garantiert dieselben Felder kennen.
--    Sonst unverändert zu 082.
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
    km_gesamt             = v_neu.km_gesamt,
    protokoll_art         = v_neu.protokoll_art
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
