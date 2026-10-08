-- ABA-/ABC-Tour in zwei AB-Touren aufteilen — und wieder zurück.
--
-- Anlass: Werden Hin- und Rückfahrt einer ABA/ABC-Tour von verschiedenen
-- Fahrern oder an verschiedenen Tagen gefahren, musste der Admin bisher
-- per Hand eine zweite Tour anlegen, Adressen/Kontakte/Fahrzeug/km
-- abtippen, den Rück-Teil der ersten Tour leeren, Zusätze und das
-- Rück-Protokoll umhängen. Fehleranfällig und mühsam.
--
-- Jetzt:
--   tour_aufteilen(tour, optionen)       — Tour 1 (bestehend) wird A → B,
--                                          Tour 2 (neu) B → C bzw. B → A.
--   tour_aufteilung_rueckgaengig(id, …)  — stellt die Originaltour aus dem
--                                          beim Aufteilen gespeicherten
--                                          Snapshot wieder her.
--
-- Beide Funktionen laufen als EINE Transaktion: schlägt irgendein
-- Schritt fehl, wird alles zurückgerollt — es entsteht nie eine halbe
-- Aufteilung. SECURITY DEFINER, weil u.a. die (für Admins bewusst
-- unlesbaren) Auftraggeber-Notizen geprüft und Greimel-Zuweisungen
-- konsistent gehalten werden müssen; Zugriff nur für Admins (is_admin()).
--
-- Was wohin wandert (Tour 2 = bisheriger Rück-Teil):
--   Fahrzeug   kennzeichen[2] → kennzeichen[1], fin_rueck → fin,
--              fahrzeugmodell_rueck → fahrzeugmodell
--   Stationen  Start = bisheriges Ziel (B, KOPIE — Tour 1 braucht B als Ziel),
--              Ziel  = bisherige Rückführung (C bzw. A, verschoben)
--              — gilt für Stadt, Adresse, Straße, PLZ, Zeit, Kontakt und
--              die Ansprechpartner (tour_ansprechpartner).
--   km         km_rueck → km_hin
--   Protokoll  eingang_id_bc → eingang_id (inkl. protokoll_daten_felder_bc,
--              auf die neuen Spaltennamen umgeschrieben)
--   Zusätze    die vom Client genannten (Default dort: nach Kennzeichen)
--   Entwürfe   die vom Client genannten (daten->>'_tour_id' umgehängt)
--   Protokoll-Zuweisungen je Template: Tour 1, Tour 2 oder beide
--   alles andere (Auftraggeber, Kunde, Sondervereinbarung, Info, Kontakt,
--              Bestätigungsstatus, erstellt_von …) wird kopiert.
-- Tour 2 bekommt ihre Tour-ID vom bestehenden Generator (assign_tour_id,
-- Advisory-Lock + unique) — keine Duplikate.
--
-- Interne Auftraggeber-Notizen (075) sind für Admins nicht lesbar und
-- werden NICHT kopiert. Hat Tour 1 eine, bekommt Tour 2 eine Notiz mit
-- einem Hinweis auf die Ursprungstour; die Funktion prüft dafür nur, OB
-- eine Notiz existiert, und gibt deren Inhalt nie zurück.
--
-- Idempotent.

-- ------------------------------------------------------------
-- 1. Referenz und Protokoll
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists aufgeteilt_von_id uuid references public.touren(id) on delete set null;

comment on column public.touren.aufgeteilt_von_id is
  'Bei einer durch Aufteilung entstandenen Tour (Tour 2): die Ursprungstour.';

create table if not exists public.tour_aufteilungen (
  id               uuid primary key default gen_random_uuid(),
  tour_id          uuid references public.touren(id) on delete set null,   -- Tour 1 (bleibt)
  neue_tour_id     uuid references public.touren(id) on delete set null,   -- Tour 2 (neu)
  tour_nr          text,
  neue_tour_nr     text,
  aufgeteilt_am    timestamptz not null default now(),
  aufgeteilt_von   uuid references public.app_users(id) on delete set null,
  -- Originalzustand für „rückgängig": Tourzeile, Rück-Ansprechpartner,
  -- Protokoll-Zuweisungen, umgehängte Entwürfe.
  snapshot         jsonb not null,
  -- Stand beider Touren direkt nach der Aufteilung (ohne updated_at &
  -- automatisch gepflegte Spalten) — daran erkennt „rückgängig", ob
  -- inzwischen jemand etwas geändert hat.
  stand_tour       jsonb not null,
  stand_neue_tour  jsonb not null,
  rueckgaengig_am  timestamptz,
  rueckgaengig_von uuid references public.app_users(id) on delete set null
);

create index if not exists idx_tour_aufteilungen_tour on public.tour_aufteilungen(tour_id);
create index if not exists idx_tour_aufteilungen_neue_tour on public.tour_aufteilungen(neue_tour_id);

alter table public.tour_aufteilungen enable row level security;
drop policy if exists tour_aufteilungen_admin_read on public.tour_aufteilungen;
create policy tour_aufteilungen_admin_read on public.tour_aufteilungen
  for select using (public.is_admin());
drop policy if exists tour_aufteilungen_test_read on public.tour_aufteilungen;
create policy tour_aufteilungen_test_read on public.tour_aufteilungen
  for select using (public.is_test());
-- Geschrieben wird ausschließlich von den Funktionen unten.
grant select on public.tour_aufteilungen to authenticated;

-- Änderungsprotokoll (079/105) um die Quelle 'aufteilung' erweitern.
alter table public.tour_aenderungen drop constraint if exists tour_aenderungen_quelle_check;
alter table public.tour_aenderungen
  add constraint tour_aenderungen_quelle_check
  check (quelle in ('auftraggeber', 'verknuepfung', 'aufteilung'));

-- ------------------------------------------------------------
-- 2. Hilfsfunktionen
-- ------------------------------------------------------------

-- Vergleichsstand einer Tour: alles außer Spalten, die sich ohne
-- Zutun des Admins ändern (updated_at; greimel_zugang_id wird von
-- release_completed_greimel_zugaenge() bei abgeschlossenen Touren
-- geleert; bearbeitet_markiert_am ist nur eine Merk-Markierung).
create or replace function public.tour_aufteilung_stand(p_tour_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(t) - 'updated_at' - 'greimel_zugang_id' - 'bearbeitet_markiert_am'
    from public.touren t where t.id = p_tour_id;
$$;
revoke all on function public.tour_aufteilung_stand(uuid) from public;

-- Setzt ALLE Spalten einer Tour aus einem jsonb (Spalten, die im jsonb
-- fehlen, werden null). Generisch über den Katalog, damit später
-- hinzukommende Spalten automatisch mitwandern. id/tour_id/created_at/
-- updated_at bleiben unangetastet.
create or replace function public.tour_aus_jsonb_setzen(p_tour_id uuid, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols  text;
  v_rcols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum),
         string_agg('r.' || quote_ident(attname), ', ' order by attnum)
    into v_cols, v_rcols
    from pg_attribute
   where attrelid = 'public.touren'::regclass
     and attnum > 0 and not attisdropped
     and attname not in ('id', 'tour_id', 'created_at', 'updated_at');
  execute format(
    'update public.touren t set (%s) = (select %s from jsonb_populate_record(null::public.touren, $1) r) where t.id = $2',
    v_cols, v_rcols)
  using p_row, p_tour_id;
end;
$$;
revoke all on function public.tour_aus_jsonb_setzen(uuid, jsonb) from public;

-- Greimel-Zuweisung nachziehen: Fahrer, der den Zugang über eine aktive
-- Tour braucht, steht in fahrer_ids; wer ihn über keine aktive Tour mehr
-- braucht, fliegt raus (gleiche Regel wie releaseZugangIfUnused im Client).
create or replace function public.greimel_fahrer_abgleichen(p_zugang_id uuid, p_fahrer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_zugang_id is null or p_fahrer_id is null then return; end if;
  if exists (
    select 1 from public.touren t
     where t.greimel_zugang_id = p_zugang_id
       and t.fahrer_id = p_fahrer_id
       and (t.enddatum is null or t.enddatum >= current_date)
  ) then
    update public.greimel_zugaenge
       set fahrer_ids = array(select distinct x from unnest(coalesce(fahrer_ids, '{}'::uuid[]) || p_fahrer_id) x)
     where id = p_zugang_id and not (p_fahrer_id = any(coalesce(fahrer_ids, '{}'::uuid[])));
  else
    update public.greimel_zugaenge
       set fahrer_ids = array_remove(fahrer_ids, p_fahrer_id)
     where id = p_zugang_id and p_fahrer_id = any(coalesce(fahrer_ids, '{}'::uuid[]));
  end if;
end;
$$;
revoke all on function public.greimel_fahrer_abgleichen(uuid, uuid) from public;

-- Rechnung/Gutschrift einer Tour als Sperrgrund (null = frei).
create or replace function public.tour_aufteilung_sperrgrund(p_tour_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nr  text;
begin
  select coalesce(r.rechnungsnummer, 'ohne Nummer (Entwurf)') into v_nr
    from public.rechnungspositionen rp join public.rechnungen r on r.id = rp.rechnung_id
   where rp.tour_id = p_tour_id limit 1;
  if v_nr is not null then
    return format('Diese Tour ist auf Rechnung %s. Bitte zuerst aus der Rechnung entfernen.', v_nr);
  end if;
  -- Gutschrift (Fahrer-Abrechnung): Honorar/Barauslagen würden sonst
  -- nicht mehr zur Gutschrift passen.
  select g.gutschrift_nr into v_nr
    from public.gutschriftspositionen gp join public.gutschriften g on g.id = gp.gutschrift_id
   where gp.tour_id = p_tour_id limit 1;
  if v_nr is not null then
    return format('Diese Tour ist auf Gutschrift %s. Bitte zuerst aus der Gutschrift entfernen.', v_nr);
  end if;
  return null;
end;
$$;
revoke all on function public.tour_aufteilung_sperrgrund(uuid) from public;
grant execute on function public.tour_aufteilung_sperrgrund(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Aufteilen
-- ------------------------------------------------------------
-- p_optionen:
-- {
--   "erwartet_updated_at": "…",           -- Stand, auf dem die Vorschau beruht
--   "tour1": { "fahrer_id", "startdatum", "enddatum", "verguetung",
--              "fahrer_honorar", "barauslagen" },
--   "tour2": { … dieselben Felder … },
--   "zusatz_ids_tour2":  [uuid, …],
--   "entwurf_ids_tour2": [uuid, …],
--   "zuweisungen": { "<template_id>": "1" | "2" | "beide" },  -- Default beide
--   "greimel_bei": 1 | 2
-- }
create or replace function public.tour_aufteilen(p_tour_id uuid, p_optionen jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t          public.touren%rowtype;
  v_o1         jsonb := coalesce(p_optionen -> 'tour1', '{}'::jsonb);
  v_o2         jsonb := coalesce(p_optionen -> 'tour2', '{}'::jsonb);
  v_zuw        jsonb := coalesce(p_optionen -> 'zuweisungen', '{}'::jsonb);
  v_greimel_bei int := coalesce(nullif(p_optionen ->> 'greimel_bei', '')::int, 1);
  v_zusatz_ids uuid[];
  v_entwurf_ids uuid[];
  v_grund      text;
  v_neu_id     uuid := gen_random_uuid();
  v_neu_nr     text;
  v_kz         text[];
  v_kz_hin     text;
  v_kz_rueck   text;
  v_felder_bc  text[];
  v_row1       jsonb;
  v_row2       jsonb;
  v_snapshot   jsonb;
  v_datum      text := to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY');
  v_aufteilung uuid;
  v_notiz_ag   uuid;
  v_hinweis    boolean := false;
  v_hinweis_text text;
  v_z          record;
  v_route_alt  text;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Touren aufteilen.' using errcode = '42501';
  end if;

  select * into v_t from public.touren where id = p_tour_id for update;
  if not found then
    raise exception 'Tour nicht gefunden.';
  end if;
  if v_t.tourenart is null or v_t.tourenart not in ('ABA', 'ABC') or v_t.rueckfuehrung_stadt is null then
    raise exception 'Nur ABA- oder ABC-Touren mit Rückführung können aufgeteilt werden.';
  end if;
  if nullif(p_optionen ->> 'erwartet_updated_at', '') is not null
     and (p_optionen ->> 'erwartet_updated_at')::timestamptz is distinct from v_t.updated_at then
    raise exception 'Die Tour wurde inzwischen geändert — bitte die Vorschau neu öffnen.';
  end if;
  v_grund := public.tour_aufteilung_sperrgrund(p_tour_id);
  if v_grund is not null then
    raise exception '%', v_grund;
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_zusatz_ids
    from jsonb_array_elements_text(coalesce(p_optionen -> 'zusatz_ids_tour2', '[]'::jsonb)) x;
  select coalesce(array_agg(x::uuid), '{}') into v_entwurf_ids
    from jsonb_array_elements_text(coalesce(p_optionen -> 'entwurf_ids_tour2', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_zusatz_ids) z
              where not exists (select 1 from public.tour_zusaetze tz where tz.id = z and tz.tour_id = p_tour_id)) then
    raise exception 'Ein ausgewählter Zusatz gehört nicht (mehr) zu dieser Tour.';
  end if;
  if v_greimel_bei not in (1, 2) then
    raise exception 'Ungültige Auswahl für den Greimel-Zugang.';
  end if;
  if coalesce((v_o1 ->> 'fahrer_honorar')::numeric, 0) < 0 or coalesce((v_o2 ->> 'fahrer_honorar')::numeric, 0) < 0
     or coalesce((v_o1 ->> 'barauslagen')::numeric, 0) < 0 or coalesce((v_o2 ->> 'barauslagen')::numeric, 0) < 0 then
    raise exception 'Honorar und Barauslagen dürfen nicht negativ sein.';
  end if;

  v_route_alt := v_t.start_stadt || ' → ' || v_t.ziel_stadt || ' → ' || v_t.rueckfuehrung_stadt;

  -- Snapshot VOR jeder Änderung.
  v_snapshot := jsonb_build_object(
    'tour', to_jsonb(v_t),
    'ansprechpartner_rueck', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.sortierung, a.created_at), '[]'::jsonb)
        from public.tour_ansprechpartner a
       where a.tour_id = p_tour_id and a.station = 'rueckfuehrung'),
    'zuweisungen', (
      select coalesce(jsonb_agg(to_jsonb(z)), '[]'::jsonb)
        from public.tour_protokoll_zuweisungen z where z.tour_id = p_tour_id),
    'zusatz_ids', to_jsonb(v_zusatz_ids),
    'entwurf_ids', to_jsonb(v_entwurf_ids)
  );

  v_kz       := coalesce(v_t.kennzeichen, '{}');
  v_kz_hin   := nullif(btrim(coalesce(v_kz[1], '')), '');
  v_kz_rueck := nullif(btrim(coalesce(v_kz[2], '')), '');

  -- Vom Rück-Protokoll befüllte Spalten auf die Spalten von Tour 2
  -- umschreiben (für „Verknüpfung lösen + zurücksetzen" dort). Städte
  -- sind NOT NULL und werden nie getrackt.
  select coalesce(array_agg(distinct m), '{}') into v_felder_bc
    from (
      select case f
               when 'fin_rueck' then 'fin'
               when 'fahrzeugmodell_rueck' then 'fahrzeugmodell'
               when 'km_rueck' then 'km_hin'
               else regexp_replace(f, '_rueckfuehrung$', '_ziel')
             end as m
        from unnest(coalesce(v_t.protokoll_daten_felder_bc, '{}')) f
       where f not like '%_stadt'
    ) s;

  -- ---- Tour 2 (neu): Kopie der Tour, Rück-Teil wird zum Haupt-Teil ----
  v_row2 := to_jsonb(v_t)
    || jsonb_build_object(
      'id', v_neu_id, 'tour_id', null, 'created_at', now(), 'updated_at', now(),
      'tourenart', 'AB',
      'start_stadt', v_t.ziel_stadt, 'ziel_stadt', v_t.rueckfuehrung_stadt, 'rueckfuehrung_stadt', null,
      'adresse_start', v_t.adresse_ziel, 'adresse_ziel', v_t.adresse_rueckfuehrung, 'adresse_rueckfuehrung', null,
      'strasse_start', v_t.strasse_ziel, 'strasse_ziel', v_t.strasse_rueckfuehrung, 'strasse_rueckfuehrung', null,
      'plz_start', v_t.plz_ziel, 'plz_ziel', v_t.plz_rueckfuehrung, 'plz_rueckfuehrung', null,
      'kontakt_start', v_t.kontakt_ziel, 'kontakt_ziel', v_t.kontakt_rueckfuehrung, 'kontakt_rueckfuehrung', null,
      'zeit_start', v_t.zeit_ziel, 'zeit_ziel', v_t.zeit_rueckfuehrung, 'zeit_rueckfuehrung', null)
    || jsonb_build_object(
      'km_hin', v_t.km_rueck, 'km_rueck', null, 'km_gesamt', v_t.km_rueck, 'aba_gesamt_km_berechnen', false,
      'kennzeichen', case when v_kz_rueck is null then '[]'::jsonb else jsonb_build_array(v_kz_rueck) end,
      'fin', v_t.fin_rueck, 'fin_rueck', null,
      'fahrzeugmodell', v_t.fahrzeugmodell_rueck, 'fahrzeugmodell_rueck', null,
      'eingang_id', v_t.eingang_id_bc, 'eingang_id_bc', null,
      'protokoll_daten_felder', to_jsonb(v_felder_bc), 'protokoll_daten_felder_bc', '[]'::jsonb,
      'greimel_zugang_id', case when v_greimel_bei = 2 then v_t.greimel_zugang_id end,
      'aufgeteilt_von_id', v_t.id)
    || jsonb_build_object(
      'fahrer_id', case when v_o2 ? 'fahrer_id' then to_jsonb(nullif(v_o2 ->> 'fahrer_id', '')) else to_jsonb(v_t.fahrer_id) end,
      'startdatum', case when v_o2 ? 'startdatum' then to_jsonb(nullif(v_o2 ->> 'startdatum', '')) else to_jsonb(v_t.startdatum) end,
      'enddatum', case when v_o2 ? 'enddatum' then to_jsonb(nullif(v_o2 ->> 'enddatum', '')) else to_jsonb(v_t.enddatum) end,
      'verguetung', case when v_o2 ? 'verguetung' then v_o2 -> 'verguetung' else 'null'::jsonb end,
      'fahrer_honorar', coalesce(v_o2 -> 'fahrer_honorar', '0'::jsonb),
      'barauslagen', coalesce(v_o2 -> 'barauslagen', '0'::jsonb));

  insert into public.touren
  select (jsonb_populate_record(null::public.touren, v_row2)).*;
  select tour_id into v_neu_nr from public.touren where id = v_neu_id;

  -- ---- Tour 1 (bestehend): Rück-Teil entfernen ----
  v_row1 := to_jsonb(v_t)
    || jsonb_build_object(
      'tourenart', 'AB',
      'rueckfuehrung_stadt', null, 'adresse_rueckfuehrung', null, 'strasse_rueckfuehrung', null,
      'plz_rueckfuehrung', null, 'kontakt_rueckfuehrung', null, 'zeit_rueckfuehrung', null,
      'km_rueck', null, 'km_gesamt', v_t.km_hin, 'aba_gesamt_km_berechnen', false,
      'kennzeichen', case when v_kz_hin is null then '[]'::jsonb else jsonb_build_array(v_kz_hin) end,
      'fin_rueck', null, 'fahrzeugmodell_rueck', null,
      'eingang_id_bc', null, 'protokoll_daten_felder_bc', '[]'::jsonb,
      'greimel_zugang_id', case when v_greimel_bei = 1 then v_t.greimel_zugang_id end)
    || jsonb_build_object(
      'fahrer_id', case when v_o1 ? 'fahrer_id' then to_jsonb(nullif(v_o1 ->> 'fahrer_id', '')) else to_jsonb(v_t.fahrer_id) end,
      'startdatum', case when v_o1 ? 'startdatum' then to_jsonb(nullif(v_o1 ->> 'startdatum', '')) else to_jsonb(v_t.startdatum) end,
      'enddatum', case when v_o1 ? 'enddatum' then to_jsonb(nullif(v_o1 ->> 'enddatum', '')) else to_jsonb(v_t.enddatum) end,
      'verguetung', case when v_o1 ? 'verguetung' then v_o1 -> 'verguetung' else to_jsonb(v_t.verguetung) end,
      'fahrer_honorar', coalesce(v_o1 -> 'fahrer_honorar', to_jsonb(v_t.fahrer_honorar)),
      'barauslagen', coalesce(v_o1 -> 'barauslagen', to_jsonb(v_t.barauslagen)));
  perform public.tour_aus_jsonb_setzen(p_tour_id, v_row1);

  -- ---- Ansprechpartner ----
  -- Station B wird für beide gebraucht: Kopie als Start von Tour 2.
  insert into public.tour_ansprechpartner (tour_id, station, name, telefon, email, sortierung)
  select v_neu_id, 'start', a.name, a.telefon, a.email, a.sortierung
    from public.tour_ansprechpartner a
   where a.tour_id = p_tour_id and a.station = 'ziel';
  -- Rückführung wandert als Ziel zu Tour 2.
  insert into public.tour_ansprechpartner (tour_id, station, name, telefon, email, sortierung)
  select v_neu_id, 'ziel', a.name, a.telefon, a.email, a.sortierung
    from public.tour_ansprechpartner a
   where a.tour_id = p_tour_id and a.station = 'rueckfuehrung';
  delete from public.tour_ansprechpartner
   where tour_id = p_tour_id and station = 'rueckfuehrung';

  -- ---- Zusätze ----
  update public.tour_zusaetze set tour_id = v_neu_id
   where tour_id = p_tour_id and id = any(v_zusatz_ids);

  -- ---- Protokoll-Zuweisungen (je Template: 1, 2 oder beide) ----
  for v_z in select * from public.tour_protokoll_zuweisungen where tour_id = p_tour_id loop
    case coalesce(v_zuw ->> v_z.template_id::text, 'beide')
      when '1' then null;
      when '2' then
        update public.tour_protokoll_zuweisungen set tour_id = v_neu_id where id = v_z.id;
      else
        insert into public.tour_protokoll_zuweisungen (tour_id, template_id, vorgefuellte_daten, sort_order)
        values (v_neu_id, v_z.template_id, v_z.vorgefuellte_daten, v_z.sort_order);
    end case;
  end loop;

  -- ---- Formular-Entwürfe des Rück-Teils ----
  update public.ausgefuellte_formulare
     set daten = jsonb_set(daten, '{_tour_id}', to_jsonb(v_neu_id::text))
   where id = any(v_entwurf_ids)
     and status = 'draft'
     and daten ->> '_tour_id' = p_tour_id::text;

  -- ---- Greimel: Zugang bleibt bei genau einer Tour ----
  if v_t.greimel_zugang_id is not null then
    perform public.greimel_fahrer_abgleichen(v_t.greimel_zugang_id, v_t.fahrer_id);
    perform public.greimel_fahrer_abgleichen(v_t.greimel_zugang_id, nullif(v_o1 ->> 'fahrer_id', '')::uuid);
    perform public.greimel_fahrer_abgleichen(v_t.greimel_zugang_id, nullif(v_o2 ->> 'fahrer_id', '')::uuid);
  end if;

  -- ---- Interne Auftraggeber-Notiz: nicht kopieren, nur Hinweis ----
  select n.auftraggeber_id into v_notiz_ag
    from public.tour_notizen_auftraggeber n where n.tour_id = p_tour_id;
  if v_notiz_ag is not null then
    v_hinweis_text := format('Diese Tour wurde am %s aus %s aufgeteilt. Ihre interne Notiz steht weiterhin bei %s.',
                             v_datum, coalesce(v_t.tour_id, 'der Ursprungstour'), coalesce(v_t.tour_id, 'der Ursprungstour'));
    insert into public.tour_notizen_auftraggeber (tour_id, auftraggeber_id, notiz, erstellt_von)
    values (v_neu_id, v_notiz_ag, v_hinweis_text, auth.uid());
    v_hinweis := true;
  end if;

  -- ---- Änderungsprotokoll beider Touren (für Admins sichtbar) ----
  insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
  values
    (p_tour_id, auth.uid(), 'aufteilung', v_t.tourenart || ': ' || v_route_alt,
     format('Aufgeteilt am %s — Rück-Teil ist jetzt %s', v_datum, v_neu_nr), 'aufteilung', now(), auth.uid()),
    (v_neu_id, auth.uid(), 'aufteilung', v_t.tourenart || ': ' || v_route_alt,
     format('Aufgeteilt aus %s am %s', coalesce(v_t.tour_id, '—'), v_datum), 'aufteilung', now(), auth.uid());

  -- Nur der selbst geschriebene Hinweistext — nie die Notiz des Kunden.
  v_snapshot := v_snapshot || jsonb_build_object('notiz_hinweis', v_hinweis, 'notiz_hinweis_text', v_hinweis_text);
  insert into public.tour_aufteilungen
    (tour_id, neue_tour_id, tour_nr, neue_tour_nr, aufgeteilt_von, snapshot, stand_tour, stand_neue_tour)
  values
    (p_tour_id, v_neu_id, v_t.tour_id, v_neu_nr, auth.uid(), v_snapshot,
     public.tour_aufteilung_stand(p_tour_id), public.tour_aufteilung_stand(v_neu_id))
  returning id into v_aufteilung;

  return jsonb_build_object(
    'ok', true,
    'aufteilung_id', v_aufteilung,
    'tour_id', p_tour_id, 'tour_nr', v_t.tour_id,
    'neue_tour_id', v_neu_id, 'neue_tour_nr', v_neu_nr,
    'notiz_hinweis', v_hinweis);
end;
$$;

revoke all on function public.tour_aufteilen(uuid, jsonb) from public;
grant execute on function public.tour_aufteilen(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4. Rückgängig
-- ------------------------------------------------------------
-- Möglich, solange
--   * Tour 2 seit der Aufteilung nicht verändert wurde,
--   * keine der beiden Touren auf einer Rechnung/Gutschrift steht,
--   * die Auftraggeber-Notiz von Tour 2 nur der automatische Hinweis ist.
-- Wurde Tour 1 inzwischen geändert, gehen diese Änderungen verloren —
-- das muss der Aufrufer ausdrücklich bestätigen (p_tour1_aenderungen_verwerfen).
-- Zusätze und Dokumente, die inzwischen an Tour 2 hängen, wandern zu
-- Tour 1 zurück (nichts geht verloren); Entwürfe ebenso.
create or replace function public.tour_aufteilung_rueckgaengig(
  p_aufteilung_id uuid,
  p_tour1_aenderungen_verwerfen boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a        public.tour_aufteilungen%rowtype;
  v_t1       public.touren%rowtype;
  v_t2       public.touren%rowtype;
  v_orig     jsonb;
  v_grund    text;
  v_datum    text := to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY');
  v_notiz    record;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen eine Aufteilung rückgängig machen.' using errcode = '42501';
  end if;

  select * into v_a from public.tour_aufteilungen where id = p_aufteilung_id for update;
  if not found then raise exception 'Aufteilung nicht gefunden.'; end if;
  if v_a.rueckgaengig_am is not null then raise exception 'Diese Aufteilung wurde bereits rückgängig gemacht.'; end if;

  select * into v_t1 from public.touren where id = v_a.tour_id for update;
  if not found then raise exception 'Die ursprüngliche Tour existiert nicht mehr.'; end if;
  select * into v_t2 from public.touren where id = v_a.neue_tour_id for update;
  if not found then raise exception 'Die neue Tour existiert nicht mehr.'; end if;

  v_grund := public.tour_aufteilung_sperrgrund(v_t1.id);
  if v_grund is not null then
    raise exception 'Rückgängig nicht möglich (%): %', coalesce(v_t1.tour_id, 'Tour 1'), v_grund;
  end if;
  v_grund := public.tour_aufteilung_sperrgrund(v_t2.id);
  if v_grund is not null then
    raise exception 'Rückgängig nicht möglich (%): %', coalesce(v_t2.tour_id, 'Tour 2'), v_grund;
  end if;
  if public.tour_aufteilung_stand(v_t2.id) is distinct from v_a.stand_neue_tour then
    raise exception 'Rückgängig nicht möglich: % wurde nach der Aufteilung geändert.', coalesce(v_t2.tour_id, 'Die neue Tour');
  end if;
  select * into v_notiz from public.tour_notizen_auftraggeber where tour_id = v_t2.id;
  -- Nur der automatische Hinweis darf mit Tour 2 verschwinden; hat der
  -- Kunde dort etwas Eigenes notiert, ginge es beim Löschen verloren.
  if found and v_notiz.notiz is distinct from (v_a.snapshot ->> 'notiz_hinweis_text') then
    raise exception 'Rückgängig nicht möglich: Der Auftraggeber hat zu % eine eigene Notiz hinterlegt.', coalesce(v_t2.tour_id, 'der neuen Tour');
  end if;
  if not p_tour1_aenderungen_verwerfen
     and public.tour_aufteilung_stand(v_t1.id) is distinct from v_a.stand_tour then
    raise exception 'TOUR1_GEAENDERT: % wurde nach der Aufteilung geändert — diese Änderungen gingen beim Rückgängigmachen verloren.', coalesce(v_t1.tour_id, 'Die Tour');
  end if;

  v_orig := v_a.snapshot -> 'tour';

  -- Was inzwischen an Tour 2 hängt, zurück zu Tour 1.
  update public.tour_zusaetze set tour_id = v_t1.id where tour_id = v_t2.id;
  update public.tour_dokumente set tour_id = v_t1.id where tour_id = v_t2.id;
  update public.ausgefuellte_formulare
     set daten = jsonb_set(daten, '{_tour_id}', to_jsonb(v_t1.id::text))
   where status = 'draft' and daten ->> '_tour_id' = v_t2.id::text;
  -- Fehlende Protokoll-Zuweisungen wiederherstellen (vorhandene bleiben).
  insert into public.tour_protokoll_zuweisungen (tour_id, template_id, vorgefuellte_daten, sort_order)
  select v_t1.id, (z ->> 'template_id')::uuid, z -> 'vorgefuellte_daten', coalesce((z ->> 'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(v_a.snapshot -> 'zuweisungen', '[]'::jsonb)) z
  on conflict (tour_id, template_id) do nothing;

  -- Tour 2 löschen (Ansprechpartner, Zuweisungen, Protokoll-Einträge und
  -- der automatische Notiz-Hinweis hängen per cascade daran). Vorher die
  -- Rückwärts-Referenz lösen, damit eingang_id_bc frei wird.
  delete from public.touren where id = v_t2.id;

  -- Originalzeile wiederherstellen.
  perform public.tour_aus_jsonb_setzen(v_t1.id, v_orig);

  -- Rück-Ansprechpartner wiederherstellen (Tour 1 hatte sie abgegeben).
  delete from public.tour_ansprechpartner where tour_id = v_t1.id and station = 'rueckfuehrung';
  insert into public.tour_ansprechpartner (tour_id, station, name, telefon, email, sortierung)
  select v_t1.id, 'rueckfuehrung', a ->> 'name', a ->> 'telefon', a ->> 'email', coalesce((a ->> 'sortierung')::int, 0)
    from jsonb_array_elements(coalesce(v_a.snapshot -> 'ansprechpartner_rueck', '[]'::jsonb)) a;

  -- Greimel-Zuweisungen nachziehen.
  if (v_orig ->> 'greimel_zugang_id') is not null then
    perform public.greimel_fahrer_abgleichen((v_orig ->> 'greimel_zugang_id')::uuid, (v_orig ->> 'fahrer_id')::uuid);
  end if;
  if v_t2.greimel_zugang_id is not null then
    perform public.greimel_fahrer_abgleichen(v_t2.greimel_zugang_id, v_t2.fahrer_id);
  end if;
  if v_t1.greimel_zugang_id is not null then
    perform public.greimel_fahrer_abgleichen(v_t1.greimel_zugang_id, v_t1.fahrer_id);
  end if;

  update public.tour_aufteilungen
     set rueckgaengig_am = now(), rueckgaengig_von = auth.uid()
   where id = v_a.id;

  insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
  values (v_t1.id, auth.uid(), 'aufteilung',
          format('aufgeteilt in %s und %s', coalesce(v_t1.tour_id, '—'), coalesce(v_t2.tour_id, '—')),
          format('Aufteilung am %s rückgängig gemacht — %s gelöscht', v_datum, coalesce(v_t2.tour_id, '—')),
          'aufteilung', now(), auth.uid());

  return jsonb_build_object('ok', true, 'tour_id', v_t1.id, 'tour_nr', v_t1.tour_id,
                            'geloeschte_tour_nr', v_t2.tour_id);
end;
$$;

revoke all on function public.tour_aufteilung_rueckgaengig(uuid, boolean) from public;
grant execute on function public.tour_aufteilung_rueckgaengig(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
