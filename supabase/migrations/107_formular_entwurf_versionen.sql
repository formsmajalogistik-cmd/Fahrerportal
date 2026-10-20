-- Formularstand serverseitig sichern + Versionen zum Wiederherstellen.
--
-- Anlass (Fall Emre Günes, 15.–19.10.2026): Ein Fahrer füllte ein Formular
-- in Safari aus, die Fotos wurden sofort hochgeladen, die Formularwerte
-- lagen aber NUR im lokalen Speicher des Geräts (IndexedDB) — der
-- Autosave schrieb ausschließlich dorthin. iOS leerte den Speicher der
-- Website; beim Öffnen am 19.10. gab es nur noch den Server-Stand vom
-- Anlegen → leeres Protokoll. Einen Versions-Mechanismus gab es nicht.
--
-- Jetzt:
--   * daten_geaendert_am  — vom Server gesetzt, sobald sich `daten` ändert
--     (bisher hatte die Tabelle überhaupt kein Änderungsdatum).
--   * daten_vorgang / daten_app_modus / daten_client_stand — vom Client
--     mitgeschickt: welcher Vorgang (autosave, hintergrund, abschliessen …),
--     Browser oder installierte App, Zeitpunkt der Eingabe auf dem Gerät.
--   * formular_entwurf_versionen — der Trigger legt bei JEDER Änderung von
--     `daten` einen Snapshot an bzw. aktualisiert den jüngsten (innerhalb
--     von 10 Minuten, solange der Stand nicht kleiner wird). Ein kleinerer
--     Stand bekommt immer einen eigenen Snapshot — der vollere davor bleibt.
--     Aufbewahrt: die 10 neuesten plus der vollste Stand.
--     Per Trigger statt vom Client: kein Schreibweg kann ihn umgehen, und
--     keine RLS-Lücke kann das Sichern verhindern.
--   * formular_daten_admin_setzen() — Admin stellt einen Stand wieder her
--     (oder ordnet Fotos zu); der aktuelle Stand wird vorher gesichert.
--
-- Idempotent.

alter table public.ausgefuellte_formulare
  add column if not exists daten_geaendert_am timestamptz,
  add column if not exists daten_vorgang      text,
  add column if not exists daten_app_modus    text,
  add column if not exists daten_client_stand timestamptz;

comment on column public.ausgefuellte_formulare.daten_geaendert_am is
  'Serverzeit der letzten Änderung von daten (Trigger, nicht vom Client setzbar).';
comment on column public.ausgefuellte_formulare.daten_vorgang is
  'Vom Client mitgeschickt: autosave | hintergrund | seitenwechsel | entwurf | zwischenprotokoll | abschliessen | nachgeholt | admin_*';

-- Anzahl ausgefüllter Felder (ohne interne _-Schlüssel, ohne leere Werte).
create or replace function public.formular_felder_anzahl(p_daten jsonb)
returns int
language sql
immutable
as $$
  select count(*)::int
    from jsonb_each(coalesce(p_daten, '{}'::jsonb)) e
   where left(e.key, 1) <> '_'
     and e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb, 'false'::jsonb);
$$;

create table if not exists public.formular_entwurf_versionen (
  id              uuid primary key default gen_random_uuid(),
  formular_id     uuid not null references public.ausgefuellte_formulare(id) on delete cascade,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  erstellt_von    uuid default auth.uid(),
  vorgang         text,
  app_modus       text,
  felder_anzahl   int not null default 0,
  daten           jsonb not null
);

create index if not exists idx_fev_formular
  on public.formular_entwurf_versionen(formular_id, erstellt_am desc);

alter table public.formular_entwurf_versionen enable row level security;
drop policy if exists fev_admin_read on public.formular_entwurf_versionen;
create policy fev_admin_read on public.formular_entwurf_versionen
  for select using (public.is_admin());
drop policy if exists fev_test_read on public.formular_entwurf_versionen;
create policy fev_test_read on public.formular_entwurf_versionen
  for select using (public.is_test());
-- Geschrieben wird nur von Trigger und Admin-Funktion (SECURITY DEFINER).
grant select on public.formular_entwurf_versionen to authenticated;

-- Bestand: Änderungsdatum = Anlage (mangels besserer Information). VOR
-- dem Trigger unten — der hielte den Wert sonst auf null fest.
update public.ausgefuellte_formulare
   set daten_geaendert_am = created_at
 where daten_geaendert_am is null;

-- ------------------------------------------------------------
-- Trigger 1 (BEFORE): Änderungsdatum der Daten serverseitig führen.
-- ------------------------------------------------------------
create or replace function public.af_daten_stand_setzen()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.daten_geaendert_am := now();
  elsif new.daten is distinct from old.daten then
    new.daten_geaendert_am := now();
  else
    -- Daten unverändert → Zeitstempel nicht vom Client verschiebbar.
    new.daten_geaendert_am := old.daten_geaendert_am;
  end if;
  return new;
end;
$$;

drop trigger if exists af_daten_stand on public.ausgefuellte_formulare;
create trigger af_daten_stand
  before insert or update on public.ausgefuellte_formulare
  for each row execute function public.af_daten_stand_setzen();

-- Aufbewahrung: die 10 neuesten + der vollste Stand.
create or replace function public.fev_aufraeumen(p_formular_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vollste uuid;
begin
  select id into v_vollste
    from public.formular_entwurf_versionen
   where formular_id = p_formular_id
   order by felder_anzahl desc, erstellt_am desc
   limit 1;
  delete from public.formular_entwurf_versionen v
   where v.formular_id = p_formular_id
     and v.id <> v_vollste
     and v.id not in (
       select id from public.formular_entwurf_versionen
        where formular_id = p_formular_id
        order by erstellt_am desc
        limit 10);
end;
$$;
revoke all on function public.fev_aufraeumen(uuid) from public;

-- ------------------------------------------------------------
-- Trigger 2 (AFTER): Snapshot anlegen / jüngsten aktualisieren.
-- ------------------------------------------------------------
create or replace function public.af_daten_versionieren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n       int := public.formular_felder_anzahl(new.daten);
  v_letzte  public.formular_entwurf_versionen%rowtype;
  v_admin   boolean := coalesce(new.daten_vorgang, '') like 'admin%';
begin
  if tg_op = 'UPDATE' and new.daten is not distinct from old.daten then
    return null;
  end if;
  -- Leere Stände (z.B. Anlegen ohne Vorbelegung) nicht versionieren —
  -- außer ein bisher gefüllter Stand wird geleert: genau DAS soll man
  -- später sehen und rückgängig machen können.
  if v_n = 0 and (tg_op = 'INSERT' or public.formular_felder_anzahl(old.daten) = 0) then
    return null;
  end if;

  select * into v_letzte
    from public.formular_entwurf_versionen
   where formular_id = new.id
   order by erstellt_am desc
   limit 1;

  -- Zusammenführen NUR unter laufenden Autosaves. Ausdrücklich gesicherte
  -- Stände (vor_*, admin_*, verworfen_*, bestand, abschliessen …) bleiben
  -- unangetastet.
  if found
     and not v_admin
     and coalesce(new.daten_vorgang, '') in ('autosave', 'hintergrund', 'seitenwechsel', 'nachgeholt')
     and coalesce(v_letzte.vorgang, '') in ('autosave', 'hintergrund', 'seitenwechsel', 'nachgeholt')
     and v_letzte.erstellt_am > now() - interval '10 minutes'
     and v_n >= v_letzte.felder_anzahl then
    update public.formular_entwurf_versionen
       set daten = new.daten, felder_anzahl = v_n, aktualisiert_am = now(),
           vorgang = new.daten_vorgang, app_modus = new.daten_app_modus
     where id = v_letzte.id;
  else
    insert into public.formular_entwurf_versionen (formular_id, vorgang, app_modus, felder_anzahl, daten)
    values (new.id, new.daten_vorgang, new.daten_app_modus, v_n, new.daten);
  end if;

  perform public.fev_aufraeumen(new.id);
  return null;
end;
$$;

drop trigger if exists af_daten_versionen on public.ausgefuellte_formulare;
create trigger af_daten_versionen
  after insert or update of daten on public.ausgefuellte_formulare
  for each row execute function public.af_daten_versionieren();

-- ------------------------------------------------------------
-- Admin: Formularwerte setzen (Version wiederherstellen, Fotos zuordnen).
-- Der aktuelle Stand wird vorher als eigener Snapshot gesichert.
-- ------------------------------------------------------------
create or replace function public.formular_daten_admin_setzen(
  p_formular_id uuid,
  p_daten jsonb,
  p_vorgang text,
  p_als_entwurf boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_af public.ausgefuellte_formulare%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Formularwerte wiederherstellen.' using errcode = '42501';
  end if;
  if p_daten is null or jsonb_typeof(p_daten) <> 'object' then
    raise exception 'Ungültige Formulardaten.';
  end if;
  select * into v_af from public.ausgefuellte_formulare where id = p_formular_id for update;
  if not found then raise exception 'Formular nicht gefunden.'; end if;

  insert into public.formular_entwurf_versionen (formular_id, vorgang, app_modus, felder_anzahl, daten)
  values (v_af.id, 'vor_' || coalesce(nullif(p_vorgang, ''), 'admin'), 'admin',
          public.formular_felder_anzahl(v_af.daten), coalesce(v_af.daten, '{}'::jsonb));

  update public.ausgefuellte_formulare
     set daten = p_daten,
         daten_vorgang = 'admin_' || coalesce(nullif(p_vorgang, ''), 'setzen'),
         daten_app_modus = 'admin',
         daten_client_stand = now(),
         status = case when p_als_entwurf then 'draft'::formular_status else status end
   where id = v_af.id;

  return jsonb_build_object('ok', true, 'felder', public.formular_felder_anzahl(p_daten),
                            'vorher_felder', public.formular_felder_anzahl(v_af.daten));
end;
$$;

revoke all on function public.formular_daten_admin_setzen(uuid, jsonb, text, boolean) from public;
grant execute on function public.formular_daten_admin_setzen(uuid, jsonb, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- Einen Stand ausdrücklich als Version sichern, ohne `daten` zu ändern —
-- z.B. den Gerätestand, den der Fahrer im Konfliktfall verwirft. Erlaubt
-- dem Fahrer des Formulars (inkl. Haupt-/Unterkonto) und Admins.
-- ------------------------------------------------------------
create or replace function public.formular_version_sichern(
  p_formular_id uuid, p_daten jsonb, p_vorgang text, p_app_modus text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fahrer uuid;
begin
  if p_daten is null or jsonb_typeof(p_daten) <> 'object' then
    raise exception 'Ungültige Formulardaten.';
  end if;
  select fahrer_id into v_fahrer from public.ausgefuellte_formulare where id = p_formular_id;
  if not found then raise exception 'Formular nicht gefunden.'; end if;
  if not (public.is_admin() or public.fahrer_belongs_to_me(v_fahrer)) or public.is_test() then
    raise exception 'Kein Zugriff auf dieses Formular.' using errcode = '42501';
  end if;
  if public.formular_felder_anzahl(p_daten) = 0 then return; end if;
  insert into public.formular_entwurf_versionen (formular_id, vorgang, app_modus, felder_anzahl, daten)
  values (p_formular_id, left(coalesce(nullif(p_vorgang, ''), 'gesichert'), 60), left(p_app_modus, 20),
          public.formular_felder_anzahl(p_daten), p_daten);
  perform public.fev_aufraeumen(p_formular_id);
end;
$$;
revoke all on function public.formular_version_sichern(uuid, jsonb, text, text) from public;
grant execute on function public.formular_version_sichern(uuid, jsonb, text, text) to authenticated;

-- Bestand: Entwürfe mit Inhalt bekommen einen ersten Snapshot.
insert into public.formular_entwurf_versionen (formular_id, erstellt_am, aktualisiert_am, erstellt_von, vorgang, app_modus, felder_anzahl, daten)
select af.id, af.created_at, af.created_at, null, 'bestand', null, public.formular_felder_anzahl(af.daten), af.daten
  from public.ausgefuellte_formulare af
 where af.status = 'draft'
   and public.formular_felder_anzahl(af.daten) > 0
   and not exists (select 1 from public.formular_entwurf_versionen v where v.formular_id = af.id);

notify pgrst, 'reload schema';
