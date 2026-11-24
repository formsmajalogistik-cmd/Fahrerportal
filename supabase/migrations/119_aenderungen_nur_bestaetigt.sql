-- ============================================================
-- Maja-Logistik Business-Portal — 119: „Änderungen durch Auftraggeber"
-- nur noch bei BESTÄTIGTEN Aufträgen anzeigen + Bestätigen mit
-- Versionsprüfung
-- ------------------------------------------------------------
-- 1. tour_aenderungen.vor_bestaetigung: Ein BEFORE-INSERT-Trigger merkt
--    sich, ob die Tour beim Eintrag noch unbestätigt war. Solche Einträge
--    bleiben im Änderungsprotokoll der Tour (Nachvollziehbarkeit), erscheinen
--    aber nicht mehr in der Anzeige „Änderungen durch Auftraggeber", nicht
--    im Badge/Zähler und lösen keine Info-Mail aus.
--    Bestehende Einträge behalten NULL (= unbekannt). Für sie gilt: angezeigt
--    nur, solange die Tour bestätigt ist. Wird eine Tour bestätigt, werden
--    ihre noch offenen Alt-Einträge (NULL) als „vor Bestätigung" markiert —
--    sonst tauchten Änderungen aus der Zeit vor dem Bestätigen danach auf.
--    Nichts wird gelöscht, gesehen_am bleibt unberührt.
-- 2. View tour_aenderungen_offen (security_invoker → RLS wie die Tabelle,
--    also nur Admin): die anzuzeigenden, unquittierten Einträge.
-- 3. Jede Auftraggeber-Änderung setzt touren.updated_at (auch Ansprechpartner,
--    die in einer eigenen Tabelle stehen) — damit ist updated_at der „Stand",
--    den der Admin beim Laden gesehen hat.
-- 4. tour_bestaetigen(p_tour_id, p_stand): bestätigt nur, wenn der
--    Auftraggeber seit p_stand nichts geändert hat; sonst Rückgabe der
--    geänderten Felder (Admin sieht Hinweis, lädt neu).
--
-- Idempotent. Bestehende Touren und Einträge werden nicht verändert.
-- ============================================================

alter table public.tour_aenderungen add column if not exists vor_bestaetigung boolean;
comment on column public.tour_aenderungen.vor_bestaetigung is
  'true = Eintrag entstand, als die Tour noch nicht bestätigt war (nur Protokoll, keine Anzeige/Benachrichtigung). '
  'NULL = Eintrag vor Migration 119.';

-- ---- 1a. Beim Eintragen den Bestätigungsstand der Tour festhalten
create or replace function public.tour_aenderung_vor_bestaetigung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vor_bestaetigung is null then
    new.vor_bestaetigung := not coalesce((select t.bestaetigt from touren t where t.id = new.tour_id), true);
  end if;
  return new;
end;
$$;

drop trigger if exists tour_aenderungen_vor_bestaetigung on public.tour_aenderungen;
create trigger tour_aenderungen_vor_bestaetigung
  before insert on public.tour_aenderungen
  for each row execute function public.tour_aenderung_vor_bestaetigung();

-- ---- 1b. Beim Bestätigen: offene Alt-Einträge (NULL) als „vor Bestätigung"
create or replace function public.tour_bestaetigt_alte_aenderungen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.bestaetigt, false) = false and new.bestaetigt = true then
    update tour_aenderungen set vor_bestaetigung = true
     where tour_id = new.id and vor_bestaetigung is null and gesehen_am is null;
  end if;
  return null;
end;
$$;

drop trigger if exists touren_bestaetigt_alte_aenderungen on public.touren;
create trigger touren_bestaetigt_alte_aenderungen
  after update of bestaetigt on public.touren
  for each row execute function public.tour_bestaetigt_alte_aenderungen();

-- ---- 2. Anzuzeigende offene Änderungen
create or replace view public.tour_aenderungen_offen
with (security_invoker = on) as
  select a.*
    from public.tour_aenderungen a
    join public.touren t on t.id = a.tour_id
   where a.gesehen_am is null
     and a.vor_bestaetigung is not true
     and t.bestaetigt = true;

comment on view public.tour_aenderungen_offen is
  'Unquittierte Änderungen an BESTÄTIGTEN Touren (Anzeige „Änderungen durch Auftraggeber", Badge, Zähler). RLS wie tour_aenderungen (nur Admin).';
grant select on public.tour_aenderungen_offen to authenticated;

-- ---- 3. Auftraggeber-Änderung → touren.updated_at (Stand für die Versionsprüfung)
create or replace function public.tour_aenderung_stand_setzen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quelle = 'auftraggeber' then
    update touren set updated_at = now() where id = new.tour_id and updated_at < now();
  end if;
  return null;
end;
$$;

drop trigger if exists tour_aenderungen_stand_setzen on public.tour_aenderungen;
create trigger tour_aenderungen_stand_setzen
  after insert on public.tour_aenderungen
  for each row execute function public.tour_aenderung_stand_setzen();

-- ---- 4. Bestätigen mit Versionsprüfung
create or replace function public.tour_bestaetigen(p_tour_id uuid, p_stand timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t      touren%rowtype;
  v_liste  jsonb;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: Bestätigen darf nur ein Admin.' using errcode = '42501';
  end if;
  -- Zeile sperren: eine gleichzeitige Auftraggeber-Änderung wartet bzw. ist schon durch.
  select * into v_t from touren where id = p_tour_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'grund', 'fehler', 'fehler', 'Tour nicht gefunden.');
  end if;
  if v_t.bestaetigt then
    return jsonb_build_object('ok', true, 'schon_bestaetigt', true, 'stand', v_t.updated_at);
  end if;
  if v_t.abgelehnt then
    return jsonb_build_object('ok', false, 'grund', 'fehler', 'fehler', 'Die Tour ist abgelehnt.');
  end if;

  if p_stand is not null then
    select jsonb_agg(jsonb_build_object('feld', a.feld, 'alt', a.wert_alt, 'neu', a.wert_neu, 'am', a.geaendert_am)
                     order by a.geaendert_am, a.feld)
      into v_liste
      from tour_aenderungen a
      join app_users u on u.id = a.geaendert_von and u.role = 'auftraggeber'
     where a.tour_id = p_tour_id
       and a.quelle = 'auftraggeber'
       and a.geaendert_am > p_stand;
    if v_liste is not null then
      return jsonb_build_object('ok', false, 'grund', 'geaendert', 'aenderungen', v_liste, 'stand', v_t.updated_at);
    end if;
  end if;

  update touren set bestaetigt = true where id = p_tour_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.tour_bestaetigen(uuid, timestamptz) from public;
grant execute on function public.tour_bestaetigen(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
