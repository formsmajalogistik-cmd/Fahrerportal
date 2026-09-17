-- Migration 096: Gesamtadressen zerlegen statt abweisen + Vergleichs-
-- schlüssel für die Dubletten-Erkennung
--
-- Zwei Richtungswechsel gegenüber 095:
--
--   1. Ein Wert mit fünfstelliger PLZ wird NICHT mehr abgewiesen,
--      sondern ZERLEGT: Straße, PLZ und Ort wandern jeweils in ihren
--      eigenen Topf. In den Straßen-Topf kommt damit weiterhin nur der
--      Straßenteil — der Rest geht nicht mehr verloren.
--
--   2. Für die Dubletten-Erkennung gibt es einen Vergleichsschlüssel.
--      Er entscheidet NUR, was zusammengehört; die angezeigte
--      Schreibweise bleibt die des Bestands. „Heiligenroder Strasse"
--      wird also nicht ungefragt zu „Heiligenroder Straße".
--
-- Die Bestandsdaten fasst diese Migration NICHT an — dafür gibt es die
-- Trockenläufe und Block-Skripte unter supabase/scripts/.

-- ------------------------------------------------------------
-- 1. Adresse zerlegen
--
--    Anker ist die erste fünfstellige Zahl, die nicht Teil einer
--    längeren Ziffernfolge ist. Straßennamen enthalten praktisch nie
--    fünfstellige Zahlen, Hausnummern auch nicht.
--
--      „Heiligenroder Strasse 38e, 28816 Stuhr"
--        → Straße „Heiligenroder Strasse 38e" | PLZ „28816" | Ort „Stuhr"
--
--    Drei Schreibweisen kommen im Bestand vor:
--
--      a) Straße zuerst   „Heiligenroder Strasse 38e, 28816 Stuhr"
--      b) PLZ zuerst      „85123 Karlskron, Münchener Straße 41"
--      c) ohne Ort        „Offakamp 10, 22529"
--
--    Unterschieden wird an der HAUSNUMMER: steht vor der PLZ eine
--    Ziffer, ist das die Straße (a). Steht dort keine und hinter der PLZ
--    folgt „Ort, Straße mit Hausnummer", ist es die umgekehrte
--    Reihenfolge (b). Bleibt hinter der PLZ gar nichts, fehlt schlicht
--    der Ort (c) — auch das ist kein Raten, der Ort bleibt NULL.
--
--    Bleibt die Straße leer, kommt überall NULL zurück; solche Werte
--    gelten als „nicht eindeutig zerlegbar" und bleiben unverändert.
-- ------------------------------------------------------------
create or replace function public.maja_adresse_zerlegen(
  wert text,
  out strasse text, out plz text, out ort text
)
language plpgsql
immutable
as $$
declare
  m       text[];
  vorne   text;
  hinten  text;
  komma   int;
  schwanz text;
begin
  strasse := null; plz := null; ort := null;
  if wert is null then return; end if;
  m := regexp_match(wert, '^(.*?)([^0-9]|^)([0-9]{5})([^0-9]|$)(.*)$');
  if m is null then return; end if;
  -- Das Zeichen vor/nach der PLZ gehört zum jeweiligen Nachbarn und
  -- wird beim Trimmen mit entfernt, falls es ein Trenner war.
  vorne  := btrim(m[1] || coalesce(m[2], ''), ' ,;-/');
  plz    := m[3];
  hinten := btrim(coalesce(m[4], '') || coalesce(m[5], ''), ' ,;-/');

  -- (b) PLZ zuerst: vor der PLZ steht keine Hausnummer, dahinter folgt
  -- „Ort, Straße <Hausnummer>". Der Teil hinter dem Komma muss eine
  -- Ziffer enthalten — sonst wäre „20095 Hamburg, Deutschland" eine
  -- Straße namens Deutschland.
  komma := position(',' in hinten);
  schwanz := case when komma > 0 then btrim(substr(hinten, komma + 1), ' ,;-/') else '' end;
  if vorne !~ '[0-9]' and komma > 0 and schwanz ~ '[0-9]' then
    ort     := btrim(substr(hinten, 1, komma - 1), ' ,;-/');
    strasse := schwanz;
  else
    -- (a) Straße zuerst, (c) ohne Ort.
    strasse := vorne;
    ort     := hinten;
  end if;

  if strasse = '' then strasse := null; end if;
  if ort = '' then ort := null; end if;
  -- Ohne Straße ist nichts gewonnen — dann gilt der Wert als nicht
  -- zerlegbar und bleibt unangetastet.
  if strasse is null then plz := null; ort := null; end if;
end;
$$;

/** Ist der Wert vollständig in alle drei Teile zerlegbar? */
create or replace function public.maja_adresse_zerlegbar(wert text)
returns boolean
language sql
immutable
as $$
  -- Straße und PLZ müssen dastehen. Der ORT darf fehlen: „Offakamp 10,
  -- 22529" ist eindeutig in Straße und PLZ zerlegbar, nur die Stadt ist
  -- nicht angegeben. Sie aus der PLZ abzuleiten wäre Raten — der Ort
  -- bleibt deshalb leer und wird beim Auswählen vom Bearbeiter ergänzt.
  select (z).strasse is not null
     and (z).plz     is not null
  from (select public.maja_adresse_zerlegen(wert) as z) t;
$$;

-- ------------------------------------------------------------
-- 2. Vergleichsschlüssel
--
--    Kleinschreibung, ß → ss, „str."/„str" → „strasse", danach alles
--    außer Buchstaben und Ziffern weg. Damit fallen zusammen:
--
--      Bahnhofstraße 5 / Bahnhofstrasse 5 / Bahnhofstr. 5 / Bahnhofstr.5
--      Bremen / bremen
--      Am Hafen 5, / Am Hafen 5
--
--    Der Schlüssel wird NIE angezeigt und NIE gespeichert — er dient
--    ausschließlich dem Gruppieren.
-- ------------------------------------------------------------
create or replace function public.maja_vergleichsschluessel(wert text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             replace(lower(btrim(coalesce(wert, ''))), 'ß', 'ss'),
             -- \M = Wortende: trifft „str.", „str " und „str" am Ende,
             -- aber nicht das „str" in „strasse".
             'str\M', 'strasse', 'g'),
           '[^a-z0-9äöü]', '', 'g');
$$;

-- ------------------------------------------------------------
-- 3. Sammeln: zerlegen statt abweisen
--
--    Ersetzt die Regel aus 095. Eingehende Werte für den Straßen-Topf,
--    die eine PLZ enthalten, werden aufgeteilt und als drei Einträge
--    verbucht. Ist der Wert nicht eindeutig zerlegbar, wird er — wie
--    bisher — übersprungen statt geraten.
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
  v_basis     text;
  v_count     int := 0;
  rec         jsonb;
  teile       record;
  -- Arbeitsliste: die Eingabe, ggf. um zerlegte Teile ergänzt.
  offen       jsonb := '[]'::jsonb;
  eintrag     jsonb;
begin
  select role into v_role from public.app_users where id = auth.uid();
  if v_role is null or v_role in ('auftraggeber', 'test') then
    return 0;
  end if;
  if jsonb_typeof(p_eintraege) <> 'array' then
    return 0;
  end if;

  -- Durchlauf 1: zerlegen. Aus einem Straßen-Eintrag mit PLZ werden
  -- drei Einträge; alles andere wandert unverändert weiter.
  for rec in select * from jsonb_array_elements(p_eintraege) loop
    v_typ  := nullif(btrim(rec ->> 'feld_typ'), '');
    v_wert := nullif(btrim(regexp_replace(coalesce(rec ->> 'wert', ''), '\s+', ' ', 'g')), '');
    if v_typ is null or v_wert is null then continue; end if;

    if (lower(v_typ) = 'adresse_strasse' or lower(v_typ) ~ '_strasse$')
       and public.maja_ist_gesamtadresse(v_wert) then
      if not public.maja_adresse_zerlegbar(v_wert) then
        -- Nicht eindeutig zerlegbar: nichts raten, nichts sammeln.
        continue;
      end if;
      select * into teile from public.maja_adresse_zerlegen(v_wert);
      -- Basis des Topfes erhalten („abholung_strasse" → „abholung").
      v_basis := regexp_replace(lower(v_typ), '_strasse$', '');
      if v_basis = 'adresse_strasse' then v_basis := 'adresse'; end if;
      offen := offen
        || jsonb_build_object('feld_typ', v_basis || '_strasse', 'wert', teile.strasse)
        || jsonb_build_object('feld_typ', v_basis || '_plz',     'wert', teile.plz)
        || jsonb_build_object('feld_typ', v_basis || '_stadt',   'wert', teile.ort);
    else
      offen := offen || jsonb_build_object('feld_typ', v_typ, 'wert', v_wert);
    end if;
  end loop;

  -- Durchlauf 2: verbuchen.
  for eintrag in select * from jsonb_array_elements(offen) loop
    v_typ  := eintrag ->> 'feld_typ';
    v_wert := eintrag ->> 'wert';
    if v_typ is null or v_wert is null then continue; end if;
    if char_length(v_wert) < 3 or char_length(v_wert) > 200 then
      -- PLZ sind fünfstellig und damit lang genug; zu kurze Orte
      -- ("Au") fallen wie bisher weg.
      continue;
    end if;

    v_wert := public.maja_vorschlag_schreibweise(v_typ, v_wert);
    -- Nur Adress-Töpfe. Die PLZ-Regel greift hier nicht mehr — was
    -- ankommt, ist bereits zerlegt.
    if not public.maja_ist_adress_topf(v_typ) then continue; end if;

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

notify pgrst, 'reload schema';
