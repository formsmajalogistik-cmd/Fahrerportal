-- „Leerfahrt" je Tour (Admin).
--
-- Eine Leerfahrt hat keine Auslagen: Beim Setzen bekommt jedes Kennzeichen
-- ohne echte Auslage einen Zusatz „Keine Auslagen" (wie der Button „Keine
-- Auslagen", Migration 113) — diese Einträge tragen herkunft = 'leerfahrt',
-- damit „Leerfahrt entfernen" genau sie wieder wegnimmt; manuell gesetzte
-- „Keine Auslagen" bleiben. In der Tourenliste erscheint die Tour mit
-- Wasserzeichen „LEERFAHRT". Auf Preis, Rechnung, PDF, Gutschrift und
-- Vergütung wirkt sie (vorerst) NICHT.
--
--   * tour_leerfahrt — eine Zeile je Leerfahrt (wer, wann). Eigene Tabelle
--     statt Spalte an touren: touren ist für Fahrer (eigene Touren) lesbar;
--     Spaltenrechte helfen nicht, weil alle Nutzer dieselbe Datenbankrolle
--     teilen (siehe 063). Lesen: Admin + Test-Rolle. Schreiben nur über
--     tour_leerfahrt_setzen() (Admin, nicht Test).
--   * tour_zusaetze.herkunft — NULL (normal) oder 'leerfahrt'.
--   * Änderungsprotokoll: Quelle 'leerfahrt'.
--   * Tour-Split (106): die Markierung wird auf die neue Tour übernommen;
--     „Keine Auslagen" wandern wie alle Zusätze über ihr Kennzeichen.
--
-- Bestehende Touren, Zusätze, Rechnungen und Beträge werden NICHT verändert.
-- Idempotent.

create table if not exists public.tour_leerfahrt (
  tour_id          uuid primary key references public.touren(id) on delete cascade,
  gesetzt_am       timestamptz not null default now(),
  gesetzt_von      uuid,
  gesetzt_von_name text
);

alter table public.tour_leerfahrt enable row level security;
drop policy if exists tour_leerfahrt_lesen on public.tour_leerfahrt;
create policy tour_leerfahrt_lesen on public.tour_leerfahrt
  for select using (public.is_admin() or public.is_test());
grant select on public.tour_leerfahrt to authenticated;

alter table public.tour_zusaetze add column if not exists herkunft text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tour_zusaetze_herkunft_check') then
    alter table public.tour_zusaetze
      add constraint tour_zusaetze_herkunft_check check (herkunft is null or herkunft in ('leerfahrt'));
  end if;
end $$;
comment on column public.tour_zusaetze.herkunft is
  'Automatisch angelegt durch: leerfahrt („Keine Auslagen" beim Markieren als Leerfahrt). NULL = normal erfasst.';

alter table public.tour_aenderungen drop constraint if exists tour_aenderungen_quelle_check;
alter table public.tour_aenderungen
  add constraint tour_aenderungen_quelle_check
  check (quelle in ('auftraggeber', 'verknuepfung', 'aufteilung', 'zuweisung', 'auslagen', 'leerfahrt'));

create or replace function public.leerfahrt_protokoll(p_tour_id uuid, p_alt text, p_neu text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from touren where id = p_tour_id) then return; end if;
  insert into tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
  values (p_tour_id, auth.uid(), 'leerfahrt', p_alt, p_neu, 'leerfahrt', now(), auth.uid());
end;
$$;
revoke all on function public.leerfahrt_protokoll(uuid, text, text) from public;

/**
 * Leerfahrt setzen (p_an) oder entfernen. Die „Keine Auslagen"-Einträge
 * beim Setzen legt der Client mit derselben Funktion wie der Button
 * „Keine Auslagen" an (herkunft 'leerfahrt'); beim Entfernen nimmt diese
 * Funktion genau diese Einträge wieder weg.
 */
create or replace function public.tour_leerfahrt_setzen(p_tour_id uuid, p_an boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_kz   text;
  v_n    int := 0;
  v_neu  boolean;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: „Leerfahrt" darf nur ein Admin setzen.' using errcode = '42501';
  end if;
  if not exists (select 1 from touren where id = p_tour_id) then raise exception 'Tour nicht gefunden'; end if;
  select coalesce(nullif(btrim(concat_ws(' ', u.vorname, u.nachname)), ''), u.email) into v_name
    from app_users u where u.id = auth.uid();

  if p_an then
    insert into tour_leerfahrt (tour_id, gesetzt_von, gesetzt_von_name)
    values (p_tour_id, auth.uid(), v_name)
    on conflict (tour_id) do nothing;
    v_neu := found;
    if v_neu then perform leerfahrt_protokoll(p_tour_id, null, 'Als Leerfahrt markiert'); end if;
    return jsonb_build_object('geaendert', v_neu);
  end if;

  delete from tour_leerfahrt where tour_id = p_tour_id;
  if not found then return jsonb_build_object('geaendert', false, 'entfernt', 0); end if;
  -- Nur die durch die Leerfahrt angelegten „Keine Auslagen" — ohne
  -- Einzel-Protokoll je Eintrag (Zusammenfassung unten).
  perform set_config('maja.keine_auslagen_auto', '1', true);
  with weg as (
    delete from tour_zusaetze
     where tour_id = p_tour_id and herkunft = 'leerfahrt' and zusatz_ist_keine_auslagen(kategorie)
    returning kennzeichen
  )
  select count(*), string_agg(coalesce(nullif(btrim(kennzeichen), ''), 'ohne Kennzeichen'), ', ')
    into v_n, v_kz from weg;
  perform set_config('maja.keine_auslagen_auto', '', true);
  perform leerfahrt_protokoll(p_tour_id, 'Leerfahrt',
    'Leerfahrt entfernt' || case when v_n > 0 then ' — automatisch gesetzte „Keine Auslagen" entfernt (' || v_kz || ')' else '' end);
  return jsonb_build_object('geaendert', true, 'entfernt', v_n);
end;
$$;
revoke all on function public.tour_leerfahrt_setzen(uuid, boolean) from public;
grant execute on function public.tour_leerfahrt_setzen(uuid, boolean) to authenticated;

-- Tour-Split (106): Leerfahrt auf die neue Tour übernehmen.
create or replace function public.leerfahrt_bei_aufteilung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.neue_tour_id is not null and exists (select 1 from tour_leerfahrt where tour_id = new.tour_id) then
    insert into tour_leerfahrt (tour_id, gesetzt_am, gesetzt_von, gesetzt_von_name)
    select new.neue_tour_id, l.gesetzt_am, l.gesetzt_von, l.gesetzt_von_name
      from tour_leerfahrt l where l.tour_id = new.tour_id
    on conflict (tour_id) do nothing;
    perform leerfahrt_protokoll(new.neue_tour_id, null, 'Leerfahrt übernommen (Aufteilung aus ' || coalesce(new.tour_nr, 'Tour') || ')');
  end if;
  return new;
end;
$$;

drop trigger if exists leerfahrt_aufteilung on public.tour_aufteilungen;
create trigger leerfahrt_aufteilung
  after insert on public.tour_aufteilungen
  for each row execute function public.leerfahrt_bei_aufteilung();

notify pgrst, 'reload schema';
