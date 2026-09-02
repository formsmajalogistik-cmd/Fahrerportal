-- Migration 095: Vorschläge sind nur noch eine Adress-Funktion
--
-- Zwei Änderungen an der Schreib-RPC:
--
--   1. Es werden ausschließlich Adress-Töpfe angenommen (Straße, PLZ,
--      Ort). Kennzeichen, FIN, Fahrzeugmodelle, E-Mails sowie Kontakt-
--      und Kundennamen sind draußen — sie sind entweder pro Fahrt
--      verschieden oder personenbezogen und taugen nicht als
--      firmenweiter Vorschlag.
--
--   2. In den Straßen-Topf darf kein Wert mit fünfstelliger PLZ. Solche
--      Einträge sind in Wahrheit ganze Adressen
--      („Heiligenroder Strasse 38e, 28816 Stuhr") und landen beim
--      Auswählen komplett im Straßenfeld. Führt ein Alt-Formular seine
--      Adresse nur als EINEN Text, wird der Wert damit gar nicht erst
--      gesammelt, statt als Straße abgelegt zu werden.
--
-- Beides steckt bewusst auch im Frontend (src/lib/feldVorschlaege.ts).
-- Hier ist die Absicherung, die nicht davon abhängt, welche Version
-- gerade im Browser liegt.
--
-- Die Bestandsbereinigung passiert NICHT hier — dafür gibt es die
-- Skripte unter supabase/scripts/ und die Pflegeansicht.

-- ------------------------------------------------------------
-- 1. Regeln als Funktionen
-- ------------------------------------------------------------
create or replace function public.maja_ist_adress_topf(feld_typ text)
returns boolean
language sql
immutable
as $$
  select case
    when coalesce(btrim(feld_typ), '') = '' then false
    else lower(btrim(feld_typ)) in ('adresse_strasse', 'adresse_plz', 'adresse_stadt')
      or lower(btrim(feld_typ)) ~ '_(strasse|plz|stadt)$'
  end;
$$;

/*
 * Fünfstellige Zahl im Wert = PLZ = ganze Adresse. Bewusst grob: eine
 * Straße enthält keine fünfstellige Zahl, eine Hausnummer auch nicht.
 */
create or replace function public.maja_ist_gesamtadresse(wert text)
returns boolean
language sql
immutable
as $$
  select coalesce(wert, '') ~ '(^|[^0-9])[0-9]{5}([^0-9]|$)';
$$;

create or replace function public.maja_pool_wert_erlaubt(feld_typ text, wert text)
returns boolean
language sql
immutable
as $$
  select public.maja_ist_adress_topf(feld_typ)
     and not (
       (lower(btrim(feld_typ)) = 'adresse_strasse'
        or lower(btrim(feld_typ)) ~ '_strasse$')
       and public.maja_ist_gesamtadresse(wert)
     );
$$;

-- ------------------------------------------------------------
-- 2. Schreib-RPC mit den neuen Regeln
--
--    Unerlaubte Einträge werden still übersprungen (kein Fehler): das
--    Formular ist zum Zeitpunkt des Aufrufs bereits eingereicht, ein
--    Abbruch würde nur den Absende-Vorgang stören.
-- ------------------------------------------------------------
create or replace function public.feld_vorschlaege_merken(p_eintraege jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text;
  v_typ       text;
  v_wert      text;
  v_bestehend text;
  v_count     int := 0;
  rec         jsonb;
begin
  select role into v_role from public.app_users where id = auth.uid();
  -- Auftraggeber: kein Zugriff auf den Pool. Test: darf lesen, nicht
  -- schreiben. Unbekannte/abgemeldete Nutzer ebenfalls nicht.
  if v_role is null or v_role in ('auftraggeber', 'test') then
    return 0;
  end if;
  if jsonb_typeof(p_eintraege) <> 'array' then
    return 0;
  end if;

  for rec in select * from jsonb_array_elements(p_eintraege) loop
    v_typ  := nullif(btrim(rec ->> 'feld_typ'), '');
    v_wert := nullif(btrim(regexp_replace(coalesce(rec ->> 'wert', ''), '\s+', ' ', 'g')), '');
    if v_typ is null or v_wert is null then continue; end if;
    -- Sehr kurze Werte (Tippfehler, "ok", "-") nicht sammeln.
    if char_length(v_wert) < 3 or char_length(v_wert) > 200 then continue; end if;

    -- Einheitliche Schreibweise, bevor irgendetwas verglichen wird.
    v_wert := public.maja_vorschlag_schreibweise(v_typ, v_wert);

    -- Nur Adress-Töpfe, und keine ganzen Adressen im Straßen-Topf.
    if not public.maja_pool_wert_erlaubt(v_typ, v_wert) then continue; end if;

    -- Gibt es den Wert schon in anderer Schreibweise? Dann diesen
    -- Eintrag hochzählen statt einen zweiten anzulegen — aber NUR, wenn
    -- der vorhandene Eintrag bereits die richtige Schreibweise hat.
    select fv.wert into v_bestehend
      from public.feld_vorschlaege fv
     where fv.feld_typ = v_typ
       and lower(fv.wert) = lower(v_wert)
       and fv.wert = public.maja_vorschlag_schreibweise(fv.feld_typ, fv.wert)
     limit 1;
    if v_bestehend is not null then v_wert := v_bestehend; end if;

    insert into public.feld_vorschlaege (feld_typ, wert)
    values (v_typ, v_wert)
    on conflict (feld_typ, wert) do update
      set anzahl         = public.feld_vorschlaege.anzahl + 1,
          letzte_nutzung = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.feld_vorschlaege_merken(jsonb) from public;
grant execute on function public.feld_vorschlaege_merken(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. Status um die Aufräum-Kandidaten erweitern
--
--    Damit zeigt die Pflegeansicht direkt, wie viele Fremd-Einträge und
--    wie viele Gesamtadressen noch im Pool liegen.
-- ------------------------------------------------------------
-- Die Signatur ändert sich (zwei Spalten mehr) — `create or replace`
-- kann OUT-Parameter nicht ändern, deshalb erst weg damit.
drop function if exists public.adress_pool_status();

create or replace function public.adress_pool_status()
returns table (
  eintraege_gesamt      int,
  offen_schreibweise    int,
  duplikat_gruppen      int,
  duplikat_ueberzaehlig int,
  adressbuch_offen      int,
  fremde_toepfe         int,
  gesamtadressen        int
)
language sql
stable
security definer
set search_path = public
as $$
  with normalisiert as (
    select
      id, feld_typ, wert,
      public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
    from public.feld_vorschlaege
  ),
  gruppen as (
    select feld_typ, lower(neu) as schluessel, count(*) as n
    from normalisiert
    group by 1, 2
    having count(*) > 1
  )
  select
    (select count(*) from normalisiert)::int,
    (select count(*) from normalisiert where wert is distinct from neu)::int,
    (select count(*) from gruppen)::int,
    (select coalesce(sum(n - 1), 0) from gruppen)::int,
    (select count(*) from public.adressbuch a
      where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
         or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
         or a.ort         is distinct from public.maja_gross_anfang(a.ort))::int,
    (select count(*) from public.feld_vorschlaege
      where not public.maja_ist_adress_topf(feld_typ))::int,
    (select count(*) from public.feld_vorschlaege
      where public.maja_ist_adress_topf(feld_typ)
        and not public.maja_pool_wert_erlaubt(feld_typ, wert))::int
  where public.is_admin();
$$;

revoke all on function public.adress_pool_status() from public;
grant execute on function public.adress_pool_status() to authenticated;

notify pgrst, 'reload schema';
