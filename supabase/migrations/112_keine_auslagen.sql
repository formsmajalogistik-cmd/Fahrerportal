-- „Keine Auslagen" je Tour — damit keine Auslagen vergessen werden.
--
-- Anlass: Für Touren gibt es Hinweise „abgeschlossen ohne Rechnung" /
-- „auf Rechnung". Für Auslagen (Zusätze, tour_zusaetze) fehlte das: eine
-- Tour ohne Zusätze konnte „keine Auslagen" oder „Auslagen vergessen"
-- bedeuten. Der Admin markiert jetzt ausdrücklich „Keine Auslagen".
--
--   * tour_keine_auslagen — eine Zeile je markierter Tour (wer, wann).
--     Eigene Tabelle statt Spalte an touren: touren ist für Fahrer und
--     Auftraggeber (eigene Touren) lesbar, diese Tabelle nur für Admin
--     und Test-Rolle (lesend). Geschrieben wird nur über die Funktion.
--   * tour_keine_auslagen_setzen(ids, an) — setzen/entfernen, Admin-only,
--     mit Eintrag im Änderungsprotokoll (tour_aenderungen, Quelle
--     'auslagen'; die Tabelle ist nur für Admins lesbar).
--   * Trigger an tour_zusaetze: kommt doch ein Zusatz dazu (oder wird
--     einer per Aufteilung umgehängt), wird die Markierung automatisch
--     entfernt und protokolliert („… entfernt, weil Zusatz hinzugefügt").
--
-- Der Auslagen-Status (keine / offen / abgerechnet / ungeklärt) wird im
-- Frontend berechnet (lib/auslagenStatus) — aus Zusätzen,
-- rechnungspositionen.zusatz_id/tour_id und dieser Markierung.
--
-- Bestehende Touren, Zusätze, Rechnungen und Beträge werden NICHT
-- verändert; es gibt keine rückwirkende Markierung. Idempotent.

create table if not exists public.tour_keine_auslagen (
  tour_id          uuid primary key references public.touren(id) on delete cascade,
  gesetzt_am       timestamptz not null default now(),
  gesetzt_von      uuid,
  gesetzt_von_name text
);

alter table public.tour_keine_auslagen enable row level security;
drop policy if exists tka_lesen on public.tour_keine_auslagen;
create policy tka_lesen on public.tour_keine_auslagen
  for select using (public.is_admin() or public.is_test());
grant select on public.tour_keine_auslagen to authenticated;

-- Änderungsprotokoll der Tour (079/105/106/108) um 'auslagen' erweitern.
alter table public.tour_aenderungen drop constraint if exists tour_aenderungen_quelle_check;
alter table public.tour_aenderungen
  add constraint tour_aenderungen_quelle_check
  check (quelle in ('auftraggeber', 'verknuepfung', 'aufteilung', 'zuweisung', 'auslagen'));

create or replace function public.tka_benutzername()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(concat_ws(' ', u.vorname, u.nachname)), ''), u.email)
    from app_users u where u.id = auth.uid()
$$;

create or replace function public.tka_protokoll(p_tour_id uuid, p_alt text, p_neu text)
returns void language sql security definer set search_path = public as $$
  -- Als gesehen eintragen: sonst erschiene der Eintrag als unquittierte
  -- Auftraggeber-Änderung.
  insert into tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
  values (p_tour_id, auth.uid(), 'keine_auslagen', p_alt, p_neu, 'auslagen', now(), auth.uid())
$$;

create or replace function public.tour_keine_auslagen_setzen(p_tour_ids uuid[], p_an boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_nr    text;
  v_n     int := 0;
  v_skip  jsonb := '[]'::jsonb;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: „Keine Auslagen" darf nur ein Admin setzen.' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_tour_ids, '{}') loop
    select tour_id into v_nr from touren where id = v_id;
    if not found then continue; end if;
    if p_an then
      if exists (select 1 from tour_zusaetze where tour_id = v_id) then
        v_skip := v_skip || jsonb_build_object('tour_id', v_id, 'tour_nr', v_nr, 'grund', 'Tour hat Zusätze');
        continue;
      end if;
      insert into tour_keine_auslagen (tour_id, gesetzt_von, gesetzt_von_name)
      values (v_id, auth.uid(), tka_benutzername())
      on conflict (tour_id) do nothing;
      if found then
        perform tka_protokoll(v_id, null, '„Keine Auslagen" gesetzt');
        v_n := v_n + 1;
      end if;
    else
      delete from tour_keine_auslagen where tour_id = v_id;
      if found then
        perform tka_protokoll(v_id, '„Keine Auslagen" gesetzt', '„Keine Auslagen" entfernt');
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('geaendert', v_n, 'uebersprungen', v_skip);
end;
$$;

revoke all on function public.tour_keine_auslagen_setzen(uuid[], boolean) from public;
grant execute on function public.tour_keine_auslagen_setzen(uuid[], boolean) to authenticated;
revoke all on function public.tka_protokoll(uuid, text, text) from public;
revoke all on function public.tka_benutzername() from public;

-- Zusatz kommt dazu → Markierung weg, protokolliert.
create or replace function public.tka_zusatz_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.tour_id is not distinct from old.tour_id then
    return new;
  end if;
  delete from tour_keine_auslagen where tour_id = new.tour_id;
  if found then
    perform tka_protokoll(new.tour_id, '„Keine Auslagen" gesetzt',
      '„Keine Auslagen" entfernt, weil Zusatz hinzugefügt (' || coalesce(new.kategorie, 'Zusatz') || ')');
  end if;
  return new;
end;
$$;

drop trigger if exists tka_zusatz on public.tour_zusaetze;
create trigger tka_zusatz
  after insert or update of tour_id on public.tour_zusaetze
  for each row execute function public.tka_zusatz_trigger();

notify pgrst, 'reload schema';
