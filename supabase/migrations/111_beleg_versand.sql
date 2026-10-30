-- Versandstatus von Rechnungen und Gutschriften.
--
-- Anlass: Ob eine Rechnung verschickt wurde, sah man nur in der Rechnung
-- selbst (rechnungen.email_versendet_am) — vergessene Rechnungen fielen
-- nicht auf.
--
-- beleg_versand ist der VERLAUF: jeder Versand bzw. jede Markierung eine
-- Zeile, nie überschrieben.
--   art 'app'            — über die App per E-Mail versendet; eingetragen
--                          erst NACH der Erfolgsbestätigung von Microsoft
--                          Graph (serverseitig, api/emails), mit Empfängern
--   art 'fehlgeschlagen' — App-Versand mit Fehler (Fehlertext)
--   art 'manuell'        — von Hand als versendet markiert: Weg (Post,
--                          eigene E-Mail, Kundenportal, persönlich,
--                          sonstiges, rückwirkend), Datum, Notiz
-- Markierungen werden nicht gelöscht, sondern mit entfernt_am/_von
-- zurückgenommen (nur manuelle). Jede Zeile trägt Benutzer + Zeitpunkt.
--
-- Der Status je Beleg wird daraus abgeleitet (Frontend lib/belegVersand):
-- letzter erfolgreicher Eintrag (app/manuell), sonst fehlgeschlagen,
-- sonst „nicht versendet". Entwürfe und stornierte Rechnungen bekommen
-- keinen Warnhinweis.
--
-- Rechte: nur Admins schreiben (über die Funktionen unten), Admin und
-- Test-Rolle lesen. Fahrer/Auftraggeber: kein Zugriff.
--
-- Bestehende Rechnungen, Nummern, Beträge und PDFs werden NICHT
-- verändert. Altbestand bekommt erst nach Probelauf + Bestätigung
-- Einträge (beleg_versand_import / beleg_versand_rueckwirkend).
-- Idempotent.

create table if not exists public.beleg_versand (
  id                uuid primary key default gen_random_uuid(),
  rechnung_id       uuid references public.rechnungen(id) on delete cascade,
  gutschrift_id     uuid references public.gutschriften(id) on delete cascade,
  art               text not null check (art in ('app', 'manuell', 'fehlgeschlagen')),
  weg               text not null check (weg in
                      ('app', 'post', 'email_eigen', 'kundenportal', 'persoenlich', 'sonstiges', 'rueckwirkend')),
  datum             date not null,
  zeitpunkt         timestamptz,
  empfaenger        text[] not null default '{}',
  cc                text[] not null default '{}',
  absender          text,
  betreff           text,
  notiz             text,
  fehler            text,
  quelle            text not null default 'app'
                      check (quelle in ('app', 'manuell', 'rueckwirkend', 'import_datenbank', 'import_postfach')),
  erstellt_von      uuid,
  erstellt_von_name text,
  created_at        timestamptz not null default now(),
  entfernt_am       timestamptz,
  entfernt_von      uuid,
  entfernt_von_name text,
  constraint beleg_versand_genau_ein_beleg check ((rechnung_id is null) <> (gutschrift_id is null)),
  constraint beleg_versand_entfernen_nur_manuell check (entfernt_am is null or art = 'manuell')
);

create index if not exists idx_beleg_versand_rechnung   on public.beleg_versand(rechnung_id) where rechnung_id is not null;
create index if not exists idx_beleg_versand_gutschrift on public.beleg_versand(gutschrift_id) where gutschrift_id is not null;

alter table public.beleg_versand enable row level security;
drop policy if exists beleg_versand_lesen on public.beleg_versand;
create policy beleg_versand_lesen on public.beleg_versand
  for select using (public.is_admin() or public.is_test());
-- Keine insert/update/delete-Policies: geschrieben wird nur über die
-- SECURITY-DEFINER-Funktionen (Admin-Prüfung + Benutzer-Stempel).
grant select on public.beleg_versand to authenticated;

-- ------------------------------------------------------------
-- Helfer
-- ------------------------------------------------------------
create or replace function public.beleg_versand_benutzername()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(concat_ws(' ', u.vorname, u.nachname)), ''), u.email)
    from app_users u where u.id = auth.uid()
$$;

create or replace function public.beleg_versand_pruefe_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: Versandstatus darf nur ein Admin ändern.' using errcode = '42501';
  end if;
end;
$$;

/** Status eines Belegs, der einen Versand-Warnhinweis bekommen darf. */
create or replace function public.beleg_versand_relevant(p_typ text, p_status text)
returns boolean language sql immutable as $$
  select case p_typ
    when 'rechnung'   then p_status in ('offen', 'bezahlt')
    when 'gutschrift' then p_status = 'final'
    else false end
$$;

-- ------------------------------------------------------------
-- 1) Einzelnen Eintrag schreiben (App-Versand nach Graph-Bestätigung,
--    fehlgeschlagener Versand, manuelle Markierung)
-- ------------------------------------------------------------
create or replace function public.beleg_versand_eintragen(
  p_typ        text,
  p_id         uuid,
  p_art        text,
  p_weg        text default null,
  p_datum      date default null,
  p_empfaenger text[] default '{}',
  p_cc         text[] default '{}',
  p_absender   text default null,
  p_betreff    text default null,
  p_notiz      text default null,
  p_fehler     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_weg  text;
begin
  perform beleg_versand_pruefe_admin();
  if p_typ not in ('rechnung', 'gutschrift') then raise exception 'Unbekannter Belegtyp %', p_typ; end if;
  if p_art not in ('app', 'manuell', 'fehlgeschlagen') then raise exception 'Unbekannte Art %', p_art; end if;
  if p_typ = 'rechnung' and not exists (select 1 from rechnungen where id = p_id) then
    raise exception 'Rechnung nicht gefunden';
  end if;
  if p_typ = 'gutschrift' and not exists (select 1 from gutschriften where id = p_id) then
    raise exception 'Gutschrift nicht gefunden';
  end if;
  v_weg := case when p_art = 'manuell' then coalesce(p_weg, 'sonstiges') else 'app' end;
  if p_art = 'manuell' and v_weg = 'app' then raise exception 'Weg „app" ist dem App-Versand vorbehalten'; end if;

  insert into beleg_versand (
    rechnung_id, gutschrift_id, art, weg, datum, zeitpunkt, empfaenger, cc, absender, betreff,
    notiz, fehler, quelle, erstellt_von, erstellt_von_name
  ) values (
    case when p_typ = 'rechnung' then p_id end,
    case when p_typ = 'gutschrift' then p_id end,
    p_art, v_weg,
    coalesce(p_datum, (now() at time zone 'Europe/Berlin')::date),
    case when p_art = 'manuell' then null else now() end,
    coalesce(p_empfaenger, '{}'), coalesce(p_cc, '{}'), p_absender, p_betreff,
    nullif(btrim(coalesce(p_notiz, '')), ''), p_fehler,
    case when p_art = 'manuell' then 'manuell' else 'app' end,
    auth.uid(), beleg_versand_benutzername()
  ) returning id into v_id;

  -- Bisheriges Versand-Feld weiter pflegen (Detailansicht, Altlogik).
  if p_art = 'app' then
    if p_typ = 'rechnung' then update rechnungen set email_versendet_am = now() where id = p_id;
    else update gutschriften set email_versendet_am = now() where id = p_id; end if;
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 2) Mehrere als versendet markieren (Sammelaktion)
-- ------------------------------------------------------------
create or replace function public.beleg_versand_markieren(
  p_typ   text,
  p_ids   uuid[],
  p_weg   text,
  p_datum date,
  p_notiz text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_markiert int := 0;
  v_skip     jsonb := '[]'::jsonb;
  r          record;
begin
  perform beleg_versand_pruefe_admin();
  if p_weg is null or p_weg = 'app' then raise exception 'Bitte einen Versandweg wählen'; end if;
  for r in
    select x.id, x.nr, x.status from (
      select id, rechnungsnummer as nr, status from rechnungen where p_typ = 'rechnung' and id = any(p_ids)
      union all
      select id, gutschrift_nr, status from gutschriften where p_typ = 'gutschrift' and id = any(p_ids)
    ) x
  loop
    if not beleg_versand_relevant(p_typ, r.status) then
      v_skip := v_skip || jsonb_build_object('id', r.id, 'nummer', r.nr, 'grund', 'Status ' || r.status);
      continue;
    end if;
    perform beleg_versand_eintragen(p_typ, r.id, 'manuell', p_weg, p_datum, '{}', '{}', null, null, p_notiz, null);
    v_markiert := v_markiert + 1;
  end loop;
  return jsonb_build_object('markiert', v_markiert, 'uebersprungen', v_skip);
end;
$$;

-- ------------------------------------------------------------
-- 3) Manuelle Markierung zurücknehmen (App-Versände bleiben)
-- ------------------------------------------------------------
create or replace function public.beleg_versand_entfernen(p_versand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform beleg_versand_pruefe_admin();
  update beleg_versand
     set entfernt_am = now(), entfernt_von = auth.uid(), entfernt_von_name = beleg_versand_benutzername()
   where id = p_versand_id and art = 'manuell' and entfernt_am is null;
  if not found then
    raise exception 'Nur aktive manuelle Markierungen lassen sich entfernen.';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4) Altfälle: alle bis Datum X als versendet markieren (Weg
--    „rückwirkend"). p_ausfuehren = false → nur Vorschau.
-- ------------------------------------------------------------
create or replace function public.beleg_versand_rueckwirkend(
  p_typ        text,
  p_bis        date,
  p_ausfuehren boolean default false
)
returns table (beleg_id uuid, nummer text, datum date, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform beleg_versand_pruefe_admin();
  for r in
    select x.id, x.nr, x.datum, x.status from (
      select re.id, re.rechnungsnummer as nr, re.datum, re.status from rechnungen re
       where p_typ = 'rechnung'
         and not exists (select 1 from beleg_versand v where v.rechnung_id = re.id
                          and v.art in ('app', 'manuell') and v.entfernt_am is null)
      union all
      select g.id, g.gutschrift_nr, g.datum, g.status from gutschriften g
       where p_typ = 'gutschrift'
         and not exists (select 1 from beleg_versand v where v.gutschrift_id = g.id
                          and v.art in ('app', 'manuell') and v.entfernt_am is null)
    ) x
    where x.datum <= p_bis and beleg_versand_relevant(p_typ, x.status)
    order by x.datum, x.nr
  loop
    beleg_id := r.id; nummer := r.nr; datum := r.datum; status := r.status;
    if p_ausfuehren then
      insert into beleg_versand (rechnung_id, gutschrift_id, art, weg, datum, notiz, quelle, erstellt_von, erstellt_von_name)
      values (case when p_typ = 'rechnung' then r.id end, case when p_typ = 'gutschrift' then r.id end,
              'manuell', 'rueckwirkend', r.datum, 'Rückwirkend als versendet markiert (alle bis ' || to_char(p_bis, 'DD.MM.YYYY') || ')',
              'rueckwirkend', auth.uid(), beleg_versand_benutzername());
    end if;
    return next;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 5) Altbestand übernehmen (nach Probelauf + Bestätigung):
--    p_eintraege = [{typ, id, datum, zeitpunkt?, empfaenger?[], betreff?, quelle}]
--    quelle 'import_datenbank' (aus email_versendet_am) oder
--    'import_postfach' (Mail in „Gesendete Elemente" gefunden).
--    Belege mit bereits erfolgreichem Eintrag werden übersprungen.
-- ------------------------------------------------------------
create or replace function public.beleg_versand_import(p_eintraege jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e      jsonb;
  v_typ  text;
  v_id   uuid;
  v_neu  int := 0;
  v_skip int := 0;
begin
  perform beleg_versand_pruefe_admin();
  for e in select * from jsonb_array_elements(coalesce(p_eintraege, '[]'::jsonb)) loop
    v_typ := e->>'typ';
    v_id := (e->>'id')::uuid;
    if (e->>'quelle') not in ('import_datenbank', 'import_postfach') then
      raise exception 'Unbekannte Import-Quelle %', e->>'quelle';
    end if;
    if exists (select 1 from beleg_versand v
                where (v.rechnung_id = v_id or v.gutschrift_id = v_id)
                  and v.art in ('app', 'manuell') and v.entfernt_am is null) then
      v_skip := v_skip + 1; continue;
    end if;
    if (v_typ = 'rechnung' and not exists (select 1 from rechnungen where id = v_id))
       or (v_typ = 'gutschrift' and not exists (select 1 from gutschriften where id = v_id))
       or v_typ not in ('rechnung', 'gutschrift') then
      v_skip := v_skip + 1; continue;
    end if;
    insert into beleg_versand (rechnung_id, gutschrift_id, art, weg, datum, zeitpunkt, empfaenger, betreff,
                               notiz, quelle, erstellt_von, erstellt_von_name)
    values (case when v_typ = 'rechnung' then v_id end, case when v_typ = 'gutschrift' then v_id end,
            'app', 'app', (e->>'datum')::date, nullif(e->>'zeitpunkt', '')::timestamptz,
            coalesce(array(select jsonb_array_elements_text(coalesce(e->'empfaenger', '[]'::jsonb))), '{}'),
            nullif(e->>'betreff', ''),
            case e->>'quelle' when 'import_datenbank' then 'Übernommen aus dem gespeicherten Versanddatum'
                              else 'Übernommen aus „Gesendete Elemente"' end,
            e->>'quelle', auth.uid(), beleg_versand_benutzername());
    v_neu := v_neu + 1;
  end loop;
  return jsonb_build_object('uebernommen', v_neu, 'uebersprungen', v_skip);
end;
$$;

revoke all on function public.beleg_versand_eintragen(text, uuid, text, text, date, text[], text[], text, text, text, text) from public;
revoke all on function public.beleg_versand_markieren(text, uuid[], text, date, text) from public;
revoke all on function public.beleg_versand_entfernen(uuid) from public;
revoke all on function public.beleg_versand_rueckwirkend(text, date, boolean) from public;
revoke all on function public.beleg_versand_import(jsonb) from public;
revoke all on function public.beleg_versand_pruefe_admin() from public;
revoke all on function public.beleg_versand_benutzername() from public;
grant execute on function public.beleg_versand_eintragen(text, uuid, text, text, date, text[], text[], text, text, text, text) to authenticated;
grant execute on function public.beleg_versand_markieren(text, uuid[], text, date, text) to authenticated;
grant execute on function public.beleg_versand_entfernen(uuid) to authenticated;
grant execute on function public.beleg_versand_rueckwirkend(text, date, boolean) to authenticated;
grant execute on function public.beleg_versand_import(jsonb) to authenticated;
grant execute on function public.beleg_versand_pruefe_admin() to authenticated;
grant execute on function public.beleg_versand_benutzername() to authenticated;

notify pgrst, 'reload schema';
