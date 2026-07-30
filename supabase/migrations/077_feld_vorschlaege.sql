-- ============================================================
-- Maja-Logistik Business-Portal — 077: Feld-Vorschläge
-- ------------------------------------------------------------
-- Werte, die in Formularfeldern schon einmal eingetragen wurden, werden
-- gesammelt und beim nächsten Ausfüllen als Vorschlag angeboten
-- (Adressen, Firmen, Kontaktnamen …). Gepoolt wird nach `feld_typ`,
-- damit z.B. alle Abhol-/Zieladressen aus demselben Topf schöpfen.
--
-- Sichtbarkeit:
--   * Admin:  lesen, löschen (Pflege-Bereich in Einstellungen).
--   * Fahrer: lesen + schreiben (über die RPC, siehe unten).
--   * Test:   NUR lesen — der Testmodus darf den Pool nicht verändern.
--   * Auftraggeber: KEIN Zugriff. Der Pool ist firmenweit und würde
--     sonst Daten anderer Kunden preisgeben.
--
-- Geschrieben wird ausschließlich über feld_vorschlaege_merken() —
-- `authenticated` bekommt bewusst KEIN insert/update auf der Tabelle.
--
-- Idempotent.
-- ============================================================

create table if not exists public.feld_vorschlaege (
  id             uuid primary key default gen_random_uuid(),
  feld_typ       text not null,
  wert           text not null,
  anzahl         int not null default 1,
  letzte_nutzung timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (feld_typ, wert)
);

-- Sortierung "häufigste zuerst, bei Gleichstand die zuletzt genutzten".
create index if not exists idx_feld_vorschlaege_typ_rang
  on public.feld_vorschlaege(feld_typ, anzahl desc, letzte_nutzung desc);

comment on table public.feld_vorschlaege is
  'Gesammelte Eingabewerte je feld_typ für die Autovervollständigung in '
  'Formularen. Firmenweit — Auftraggeber haben per RLS keinen Zugriff.';

alter table public.feld_vorschlaege enable row level security;

-- ---- Policies ----------------------------------------------------

-- Lesen: alle angemeldeten Rollen AUSSER Auftraggeber. Admin, Fahrer und
-- Test-Profile teilen sich denselben Pool.
drop policy if exists fv_read on public.feld_vorschlaege;
create policy fv_read on public.feld_vorschlaege
  for select using (not public.is_auftraggeber());

-- Pflege (Tippfehler entfernen) nur für Admins.
drop policy if exists fv_admin_delete on public.feld_vorschlaege;
create policy fv_admin_delete on public.feld_vorschlaege
  for delete using (public.is_admin());

-- Bewusst KEIN insert/update-Grant: Schreiben läuft nur über die RPC.
grant select, delete on public.feld_vorschlaege to authenticated;

-- ------------------------------------------------------------
-- Schreib-RPC: nimmt eine Liste [{feld_typ, wert}, …] entgegen und
-- zählt jeden Wert hoch bzw. legt ihn an.
--
-- SECURITY DEFINER, weil `authenticated` keine Schreibrechte auf der
-- Tabelle hat. Die Rollenprüfung passiert deshalb HIER — Auftraggeber
-- und Test-Profile laufen wirkungslos durch (kein Fehler, damit ein
-- Formular im Testmodus normal abgeschickt werden kann).
-- ------------------------------------------------------------
create or replace function public.feld_vorschlaege_merken(p_eintraege jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
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
    -- Mehrfache Leerzeichen zusammenziehen, damit "Muster  Str." und
    -- "Muster Str." nicht als zwei Vorschläge landen.
    v_wert := nullif(btrim(regexp_replace(coalesce(rec ->> 'wert', ''), '\s+', ' ', 'g')), '');
    if v_typ is null or v_wert is null then continue; end if;
    -- Sehr kurze Werte (Tippfehler, "ok", "-") nicht sammeln.
    if char_length(v_wert) < 3 or char_length(v_wert) > 200 then continue; end if;

    -- Gibt es den Wert schon in anderer Schreibweise? Dann diesen
    -- Eintrag hochzählen, statt einen zweiten Vorschlag anzulegen — die
    -- zuerst gespeicherte Schreibweise bleibt erhalten.
    select fv.wert into v_bestehend
      from public.feld_vorschlaege fv
     where fv.feld_typ = v_typ and lower(fv.wert) = lower(v_wert)
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

notify pgrst, 'reload schema';
