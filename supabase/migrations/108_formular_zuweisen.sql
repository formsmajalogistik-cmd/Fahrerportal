-- Begonnenes Formular einem anderen Fahrer zuweisen (Admin).
--
-- Fahrer A beginnt ein Formular (z.B. Übernahme), Fahrer B soll es
-- fortsetzen und abschließen (Übergabe). Voraussetzung ist der laufende
-- Server-Autosave aus Migration 107 — nur dann liegt der Stand von A auf
-- dem Server und B kann ihn sehen.
--
--   formular_zuweisen(formular, an_fahrer, tour_mitnehmen, notiz)
--     Admin-only, atomar: Snapshot „vor_zuweisung", Bearbeiter → B,
--     Bearbeiter-Kennung +1, optional Tour (inkl. Greimel), Protokoll.
--     Fotos bleiben, wo sie sind: der OneDrive-Ordner hängt am Formular
--     (Datum/Kennzeichen/Template), nicht am Fahrer.
--
--   Bearbeiter-Kennung (bearbeiter_version)
--     Jede Zuweisung erhöht sie. Der Client schickt beim Speichern die
--     Kennung mit, mit der er das Formular geladen hat. Ein Gerät mit
--     altem Stand (Fahrer A nach der Zuweisung) wird serverseitig
--     abgelehnt: zwischen verschiedenen Fahrern verhindert das schon die
--     RLS (fahrer_id), innerhalb einer Konto-Familie (Haupt/Unterkonto —
--     gleicher Login!) erst diese Kennung.
--
--   formular_eingang_nach_zuweisung(formular, daten)
--     Das abgelehnte Gerät liefert seinen lokalen Stand als Snapshot ab
--     („nach_zuweisung_geraet") — nichts geht verloren, der Admin kann
--     Werte daraus übernehmen. Erlaubt nur früheren Bearbeitern.
--
--   formular_zuweisung_hinweis(formular)
--     Für das Gerät von A: „wurde einem anderen Fahrer zugewiesen" —
--     ohne den Namen von B preiszugeben.
--
-- Auftraggeber sehen davon nichts (keine neue AG-Sicht, keine Namen).
-- Idempotent.

alter table public.ausgefuellte_formulare
  add column if not exists bearbeiter_version       int not null default 1,
  add column if not exists zugewiesen_am            timestamptz,
  add column if not exists zugewiesen_von           uuid references public.app_users(id) on delete set null,
  add column if not exists zugewiesen_von_fahrer_id uuid references public.fahrer(id) on delete set null,
  add column if not exists zugewiesen_notiz         text;

comment on column public.ausgefuellte_formulare.bearbeiter_version is
  'Erhöht sich bei jeder Zuweisung an einen anderen Fahrer. Speichern mit veralteter Kennung wird abgelehnt.';

create table if not exists public.formular_zuweisungen (
  id                uuid primary key default gen_random_uuid(),
  formular_id       uuid not null references public.ausgefuellte_formulare(id) on delete cascade,
  von_fahrer_id     uuid references public.fahrer(id) on delete set null,
  an_fahrer_id      uuid references public.fahrer(id) on delete set null,
  von_name          text,
  an_name           text,
  zugewiesen_am     timestamptz not null default now(),
  zugewiesen_von    uuid references public.app_users(id) on delete set null,
  notiz             text,
  felder_anzahl     int,
  tour_id           uuid references public.touren(id) on delete set null,
  tour_mitgenommen  boolean not null default false,
  bearbeiter_version int not null
);
create index if not exists idx_formular_zuweisungen_formular
  on public.formular_zuweisungen(formular_id, zugewiesen_am desc);

alter table public.formular_zuweisungen enable row level security;
drop policy if exists fz_admin_read on public.formular_zuweisungen;
create policy fz_admin_read on public.formular_zuweisungen
  for select using (public.is_admin() or public.is_test());
grant select on public.formular_zuweisungen to authenticated;

-- Änderungsprotokoll der Tour (079/105/106) um 'zuweisung' erweitern.
alter table public.tour_aenderungen drop constraint if exists tour_aenderungen_quelle_check;
alter table public.tour_aenderungen
  add constraint tour_aenderungen_quelle_check
  check (quelle in ('auftraggeber', 'verknuepfung', 'aufteilung', 'zuweisung'));

-- ------------------------------------------------------------
-- Bearbeiter-Prüfung beim Speichern + Schutz der Zuweisungs-Spalten
-- ------------------------------------------------------------
create or replace function public.af_bearbeiter_pruefen()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.bearbeiter_version := 1;
    new.zugewiesen_am := null; new.zugewiesen_von := null;
    new.zugewiesen_von_fahrer_id := null; new.zugewiesen_notiz := null;
    return new;
  end if;
  -- Daten oder Status ändern darf nur, wer die AKTUELLE Kennung kennt.
  -- Clients ohne Kennung im UPDATE (ältere App-Versionen) schicken die
  -- Spalte nicht mit → sie bleibt gleich → bisheriges Verhalten.
  if (new.daten is distinct from old.daten or new.status is distinct from old.status)
     and new.bearbeiter_version is distinct from old.bearbeiter_version then
    raise exception 'NICHT_BEARBEITER: Dieses Formular wurde einem anderen Fahrer zugewiesen.'
      using errcode = 'P0001';
  end if;
  new.bearbeiter_version := old.bearbeiter_version;
  new.zugewiesen_am := old.zugewiesen_am;
  new.zugewiesen_von := old.zugewiesen_von;
  new.zugewiesen_von_fahrer_id := old.zugewiesen_von_fahrer_id;
  new.zugewiesen_notiz := old.zugewiesen_notiz;
  return new;
end;
$$;

drop trigger if exists af_bearbeiter_pruefen on public.ausgefuellte_formulare;
create trigger af_bearbeiter_pruefen
  before insert or update on public.ausgefuellte_formulare
  for each row execute function public.af_bearbeiter_pruefen();

-- ------------------------------------------------------------
-- Zuweisen (Admin)
-- ------------------------------------------------------------
create or replace function public.formular_zuweisen(
  p_formular_id uuid,
  p_an_fahrer_id uuid,
  p_tour_mitnehmen boolean default false,
  p_notiz text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_af       public.ausgefuellte_formulare%rowtype;
  v_von_name text;
  v_an_name  text;
  v_tour     public.touren%rowtype;
  v_tour_id  uuid;
  v_n        int;
  v_datum    text := to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI');
  v_admin    text;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'Nur Admins dürfen Formulare zuweisen.' using errcode = '42501';
  end if;
  select * into v_af from public.ausgefuellte_formulare where id = p_formular_id for update;
  if not found then raise exception 'Formular nicht gefunden.'; end if;
  if v_af.status <> 'draft' or v_af.uebertragen_auf_id is not null then
    raise exception 'Nur begonnene, nicht abgeschlossene Formulare können zugewiesen werden.';
  end if;
  if p_an_fahrer_id is null or not exists (select 1 from public.fahrer where id = p_an_fahrer_id and coalesce(aktiv, true)) then
    raise exception 'Ziel-Fahrer nicht gefunden oder nicht aktiv.';
  end if;
  if p_an_fahrer_id = v_af.fahrer_id then
    raise exception 'Das Formular ist diesem Fahrer bereits zugeordnet.';
  end if;

  v_von_name := public.fahrer_anzeigename(v_af.fahrer_id);
  v_an_name  := public.fahrer_anzeigename(p_an_fahrer_id);
  v_n        := public.formular_felder_anzahl(v_af.daten);
  select coalesce(nullif(btrim(concat_ws(' ', vorname, nachname)), ''), email) into v_admin
    from public.app_users where id = auth.uid();

  -- 1) Snapshot des aktuellen Stands
  insert into public.formular_entwurf_versionen (formular_id, vorgang, app_modus, felder_anzahl, daten)
  values (v_af.id, 'vor_zuweisung', 'admin', v_n, coalesce(v_af.daten, '{}'::jsonb));
  perform public.fev_aufraeumen(v_af.id);

  -- 2+3) Bearbeiter → B, Kennung +1
  update public.ausgefuellte_formulare
     set fahrer_id = p_an_fahrer_id,
         bearbeiter_version = v_af.bearbeiter_version + 1,
         zugewiesen_am = now(),
         zugewiesen_von = auth.uid(),
         zugewiesen_von_fahrer_id = v_af.fahrer_id,
         zugewiesen_notiz = nullif(btrim(coalesce(p_notiz, '')), '')
   where id = v_af.id;

  -- 5) Tour (über _tour_id bzw. Verknüpfung)
  v_tour_id := nullif(v_af.daten ->> '_tour_id', '')::uuid;
  if v_tour_id is null then
    select id into v_tour_id from public.touren
     where eingang_id = v_af.id or eingang_id_bc = v_af.id limit 1;
  end if;
  if v_tour_id is not null then
    select * into v_tour from public.touren where id = v_tour_id for update;
  end if;
  if p_tour_mitnehmen and v_tour.id is not null and v_tour.fahrer_id is distinct from p_an_fahrer_id then
    update public.touren set fahrer_id = p_an_fahrer_id where id = v_tour.id;
    -- Greimel-Zugang konsistent halten (gleiche Regel wie Aufteilen, 106)
    if v_tour.greimel_zugang_id is not null then
      perform public.greimel_fahrer_abgleichen(v_tour.greimel_zugang_id, p_an_fahrer_id);
      perform public.greimel_fahrer_abgleichen(v_tour.greimel_zugang_id, v_tour.fahrer_id);
    end if;
    insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
    values (v_tour.id, auth.uid(), 'fahrer_id', public.fahrer_anzeigename(v_tour.fahrer_id), v_an_name, 'zuweisung', now(), auth.uid());
  end if;

  -- 6) Protokoll
  insert into public.formular_zuweisungen
    (formular_id, von_fahrer_id, an_fahrer_id, von_name, an_name, zugewiesen_von, notiz, felder_anzahl,
     tour_id, tour_mitgenommen, bearbeiter_version)
  values
    (v_af.id, v_af.fahrer_id, p_an_fahrer_id, v_von_name, v_an_name, auth.uid(),
     nullif(btrim(coalesce(p_notiz, '')), ''), v_n, v_tour.id,
     coalesce(p_tour_mitnehmen, false) and v_tour.id is not null, v_af.bearbeiter_version + 1);
  if v_tour.id is not null then
    insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu, quelle, gesehen_am, gesehen_von)
    values (v_tour.id, auth.uid(), 'formular_zugewiesen', v_von_name,
            format('Formular von %s an %s zugewiesen am %s durch %s', v_von_name, v_an_name, v_datum, coalesce(v_admin, 'Admin')),
            'zuweisung', now(), auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'von', v_von_name, 'an', v_an_name, 'felder', v_n,
                            'tour_id', v_tour.id, 'tour_mitgenommen', coalesce(p_tour_mitnehmen, false) and v_tour.id is not null,
                            'bearbeiter_version', v_af.bearbeiter_version + 1);
end;
$$;
revoke all on function public.formular_zuweisen(uuid, uuid, boolean, text) from public;
grant execute on function public.formular_zuweisen(uuid, uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- Früherer Bearbeiter: lokalen Stand als Snapshot abliefern
-- ------------------------------------------------------------
create or replace function public.formular_eingang_nach_zuweisung(p_formular_id uuid, p_daten jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_af public.ausgefuellte_formulare%rowtype;
begin
  if public.is_test() then raise exception 'Testmodus — nichts gespeichert.' using errcode = '42501'; end if;
  select * into v_af from public.ausgefuellte_formulare where id = p_formular_id;
  if not found then return jsonb_build_object('ok', false, 'zugewiesen', false); end if;
  -- Nur, wer das Formular früher bearbeitet hat und es jetzt nicht mehr ist.
  if not exists (
    select 1 from public.formular_zuweisungen z
     where z.formular_id = v_af.id and z.von_fahrer_id is not null and public.fahrer_belongs_to_me(z.von_fahrer_id)
  ) then
    return jsonb_build_object('ok', false, 'zugewiesen', false);
  end if;
  if p_daten is not null and jsonb_typeof(p_daten) = 'object' and public.formular_felder_anzahl(p_daten) > 0
     and p_daten is distinct from v_af.daten then
    insert into public.formular_entwurf_versionen (formular_id, vorgang, app_modus, felder_anzahl, daten)
    values (v_af.id, 'nach_zuweisung_geraet', 'geraet_vorheriger_fahrer', public.formular_felder_anzahl(p_daten), p_daten);
    perform public.fev_aufraeumen(v_af.id);
  end if;
  return jsonb_build_object('ok', true, 'zugewiesen', true, 'zugewiesen_am', v_af.zugewiesen_am);
end;
$$;
revoke all on function public.formular_eingang_nach_zuweisung(uuid, jsonb) from public;
grant execute on function public.formular_eingang_nach_zuweisung(uuid, jsonb) to authenticated;

-- Für das Gerät des früheren Bearbeiters: wurde weggegeben? (ohne Namen)
create or replace function public.formular_zuweisung_hinweis(p_formular_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (
    select 1 from public.formular_zuweisungen z
      join public.ausgefuellte_formulare af on af.id = z.formular_id
     where z.formular_id = p_formular_id
       and z.von_fahrer_id is not null and public.fahrer_belongs_to_me(z.von_fahrer_id)
  ) then jsonb_build_object(
    'zugewiesen', true,
    'zugewiesen_am', (select zugewiesen_am from public.ausgefuellte_formulare where id = p_formular_id),
    'bearbeiter_version', (select bearbeiter_version from public.ausgefuellte_formulare where id = p_formular_id))
  else jsonb_build_object('zugewiesen', false) end;
$$;
revoke all on function public.formular_zuweisung_hinweis(uuid) from public;
grant execute on function public.formular_zuweisung_hinweis(uuid) to authenticated;

notify pgrst, 'reload schema';
