-- Formular auf ein anderes Template übertragen.
--
-- Fahrer füllen manchmal das falsche Template aus. Der Admin überträgt
-- das Formular dann auf das richtige — und legt dabei in einer
-- Vergleichsansicht fest, welcher Wert in welches Feld wandert.
--
-- Grundprinzip: Das Original bleibt unangetastet. Die Übertragung legt
-- ein NEUES Formular an; das Original wird nur markiert
-- (`uebertragen_auf_id`) und aus den normalen Listen ausgeblendet, bleibt
-- aber einsehbar. Das neue Formular verweist zurück (`uebertragen_von_id`).
-- Jeder Vorgang steht im Verlauf (`formular_uebertragungen`), und solange
-- am neuen Formular nichts geändert wurde, lässt er sich rückgängig machen.
--
-- Die Zuordnung selbst (welcher Wert wohin, Typumwandlung, Optionen)
-- rechnet das Frontend; hier wird das Ergebnis atomar geschrieben und
-- abgesichert. Nur Admins — die Test-Rolle darf lesen, aber nicht
-- übertragen.

-- ------------------------------------------------------------
-- 1. Spalten am Formular
-- ------------------------------------------------------------

alter table public.ausgefuellte_formulare
  add column if not exists uebertragen_auf_id uuid
    references public.ausgefuellte_formulare(id) on delete set null,
  add column if not exists uebertragen_am     timestamptz,
  add column if not exists uebertragen_von    uuid,
  add column if not exists uebertragen_von_id uuid
    references public.ausgefuellte_formulare(id) on delete set null;

comment on column public.ausgefuellte_formulare.uebertragen_auf_id is
  'Gesetzt = dieses Formular wurde auf ein anderes Template übertragen; Verweis auf das neue Formular. Aus Listen ausgeblendet, bleibt einsehbar.';
comment on column public.ausgefuellte_formulare.uebertragen_von_id is
  'Dieses Formular entstand durch Übertragung aus dem genannten Original.';

create index if not exists af_uebertragen_auf_idx
  on public.ausgefuellte_formulare (uebertragen_auf_id) where uebertragen_auf_id is not null;
create index if not exists af_uebertragen_von_idx
  on public.ausgefuellte_formulare (uebertragen_von_id) where uebertragen_von_id is not null;

-- ------------------------------------------------------------
-- 2. Verlauf
-- ------------------------------------------------------------

create table if not exists public.formular_uebertragungen (
  id                     bigint generated always as identity primary key,
  quelle_id              uuid not null references public.ausgefuellte_formulare(id) on delete cascade,
  ziel_id                uuid references public.ausgefuellte_formulare(id) on delete set null,
  quelle_template_id     uuid,
  ziel_template_id       uuid,
  quelle_template_name   text,
  ziel_template_name     text,
  von                    uuid not null,
  von_name               text,
  am                     timestamptz not null default now(),
  anzahl_uebernommen     int not null default 0,
  anzahl_verworfen       int not null default 0,
  -- [{feld, label, wert}] — Text der verworfenen Werte, damit nichts
  -- unbemerkt verloren geht.
  verworfen              jsonb not null default '[]'::jsonb,
  -- Felder, deren Unterschrift übertragen wurde (geleistet auf dem Original).
  unterschriften         jsonb not null default '[]'::jsonb,
  hinweise               jsonb not null default '[]'::jsonb,
  -- {quellFeld: zielFeld | null}
  zuordnung              jsonb not null default '{}'::jsonb,
  -- Stand des neuen Formulars direkt nach der Übertragung — Grundlage
  -- für „rückgängig nur, solange nichts geändert wurde".
  daten_bei_uebertragung jsonb,
  status_bei_uebertragung text,
  -- Was an Touren/Zuweisungen umgestellt wurde, damit Rückgängig es
  -- exakt zurückdrehen kann.
  umgestellt             jsonb not null default '{}'::jsonb,
  rueckgaengig_am        timestamptz,
  rueckgaengig_von       uuid
);

create index if not exists fu_quelle_idx on public.formular_uebertragungen (quelle_id);
create index if not exists fu_ziel_idx   on public.formular_uebertragungen (ziel_id);

alter table public.formular_uebertragungen enable row level security;

drop policy if exists fu_admin_read on public.formular_uebertragungen;
create policy fu_admin_read on public.formular_uebertragungen
  for select using (public.is_admin() or public.is_test());
-- Keine Schreib-Policies: geschrieben wird ausschließlich über die RPCs.
grant select on public.formular_uebertragungen to authenticated;

-- ------------------------------------------------------------
-- 3. Gemerkte Zuordnungen Template A → B
-- ------------------------------------------------------------

create table if not exists public.template_zuordnungen (
  quelle_template_id uuid not null references public.formular_templates(id) on delete cascade,
  ziel_template_id   uuid not null references public.formular_templates(id) on delete cascade,
  zuordnung          jsonb not null,
  aktualisiert_am    timestamptz not null default now(),
  aktualisiert_von   uuid,
  primary key (quelle_template_id, ziel_template_id)
);

alter table public.template_zuordnungen enable row level security;

drop policy if exists tz_admin_read on public.template_zuordnungen;
create policy tz_admin_read on public.template_zuordnungen
  for select using (public.is_admin() or public.is_test());
grant select on public.template_zuordnungen to authenticated;

-- ------------------------------------------------------------
-- 4. Absicherung der neuen Spalten
--
-- Fahrer dürfen eigene Entwürfe bearbeiten (af_self_update). Ohne diese
-- Sperre könnten sie per Direkt-Aufruf die Übertragungs-Spalten setzen.
-- Ändern darf sie nur ein Admin (die RPCs laufen mit seiner Kennung).
-- ------------------------------------------------------------

create or replace function public.af_uebertragung_spalten_schuetzen()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.uebertragen_auf_id is not null or new.uebertragen_von_id is not null
       or new.uebertragen_am is not null or new.uebertragen_von is not null then
      raise exception 'Übertragungs-Felder dürfen nur Admins setzen' using errcode = '42501';
    end if;
  elsif new.uebertragen_auf_id is distinct from old.uebertragen_auf_id
     or new.uebertragen_von_id is distinct from old.uebertragen_von_id
     or new.uebertragen_am     is distinct from old.uebertragen_am
     or new.uebertragen_von    is distinct from old.uebertragen_von then
    raise exception 'Übertragungs-Felder dürfen nur Admins ändern' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists af_uebertragung_spalten_schuetzen_trg on public.ausgefuellte_formulare;
create trigger af_uebertragung_spalten_schuetzen_trg
  before insert or update on public.ausgefuellte_formulare
  for each row execute function public.af_uebertragung_spalten_schuetzen();

-- Übertragene Originale kann der Fahrer nicht mehr bearbeiten — sonst
-- liefe ein noch offener Entwurf auf seinem Gerät am neuen Formular
-- vorbei weiter. (Admins weiterhin.)
drop policy if exists af_self_update on public.ausgefuellte_formulare;
create policy af_self_update on public.ausgefuellte_formulare
  for update using (
    public.is_admin()
    or (
      status = 'draft'
      and uebertragen_auf_id is null
      and public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
    )
  ) with check (
    public.is_admin()
    or public.fahrer_belongs_to_me(ausgefuellte_formulare.fahrer_id)
  );

-- Auftraggeber sehen nur das gültige Formular, nicht das übertragene
-- Original (das über `_tour_id` sonst weiter zu ihrer Tour passte).
drop policy if exists af_auftraggeber_read on public.ausgefuellte_formulare;
create policy af_auftraggeber_read on public.ausgefuellte_formulare
  for select using (
    public.is_auftraggeber()
    and uebertragen_auf_id is null
    and public.af_gehoert_zu_meinem_ag(id, daten->>'_tour_id')
  );

-- ------------------------------------------------------------
-- 5. RPC: übertragen
--
-- p_daten       fertiger Formularstand für das Ziel-Template (vom
--               Frontend aus der bestätigten Zuordnung gebaut)
-- p_protokoll   {anzahl_uebernommen, anzahl_verworfen, verworfen[],
--                unterschriften[], hinweise[], zuordnung{}}
-- p_vorgefuellt umgerechnete Vorgaben für die Tour-Zuweisung (oder null)
-- p_merken      Zuordnung für dieses Template-Paar speichern
-- ------------------------------------------------------------

create or replace function public.formular_uebertragen(
  p_quelle_id        uuid,
  p_ziel_template_id uuid,
  p_daten            jsonb,
  p_protokoll        jsonb,
  p_vorgefuellt      jsonb default null,
  p_merken           boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  q          public.ausgefuellte_formulare%rowtype;
  neu_id     uuid;
  alt_name   text;
  ziel_name  text;
  ich_name   text;
  v_tour_id  uuid;
  zuw_id     uuid;
  vorgaben_alt jsonb;
  touren_ab  uuid[];
  touren_bc  uuid[];
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'Nur Admins dürfen Formulare übertragen' using errcode = '42501';
  end if;
  if p_daten is null or jsonb_typeof(p_daten) <> 'object' then
    raise exception 'Formularstand fehlt oder ist ungültig';
  end if;

  select * into q from public.ausgefuellte_formulare where id = p_quelle_id for update;
  if not found then raise exception 'Formular nicht gefunden'; end if;
  if q.uebertragen_auf_id is not null then
    raise exception 'Dieses Formular wurde bereits übertragen';
  end if;
  if q.template_id = p_ziel_template_id then
    raise exception 'Ziel-Template ist dasselbe wie das bisherige';
  end if;

  select name into ziel_name from public.formular_templates
   where id = p_ziel_template_id and archiviert = false;
  if ziel_name is null then raise exception 'Ziel-Template nicht gefunden oder archiviert'; end if;
  select name into alt_name from public.formular_templates where id = q.template_id;
  select coalesce(nullif(trim(concat_ws(' ', vorname, nachname)), ''), email)
    into ich_name from public.app_users where id = auth.uid();

  insert into public.ausgefuellte_formulare (
    fahrer_id, template_id, daten, status, created_at, gesehen_am,
    zwischenprotokoll_url, zwischenprotokoll_erstellt_am,
    zwischenprotokoll_status, zwischenprotokoll_fehler, zwischenprotokoll_versendet_am,
    uebertragen_von_id
  ) values (
    q.fahrer_id, p_ziel_template_id, p_daten, q.status, q.created_at,
    -- Der Admin hat den Vorgang selbst ausgelöst — kein „neu"-Badge.
    coalesce(q.gesehen_am, now()),
    q.zwischenprotokoll_url, q.zwischenprotokoll_erstellt_am,
    q.zwischenprotokoll_status, q.zwischenprotokoll_fehler, q.zwischenprotokoll_versendet_am,
    q.id
  ) returning id into neu_id;

  update public.ausgefuellte_formulare
     set uebertragen_auf_id = neu_id, uebertragen_am = now(), uebertragen_von = auth.uid()
   where id = q.id;

  -- Tour-Verknüpfung (Eingang am Abschnitt AB / BC) auf das neue Formular.
  select coalesce(array_agg(id), '{}') into touren_ab from public.touren where eingang_id = q.id;
  select coalesce(array_agg(id), '{}') into touren_bc from public.touren where eingang_id_bc = q.id;
  update public.touren set eingang_id    = neu_id where eingang_id    = q.id;
  update public.touren set eingang_id_bc = neu_id where eingang_id_bc = q.id;

  -- Zuweisung „Tour + Template" umstellen, damit es beim Fahrer unter dem
  -- richtigen Template erscheint. Nur wenn die Tour das Ziel-Template
  -- nicht schon hat (unique tour_id, template_id).
  begin
    v_tour_id := nullif(p_daten->>'_tour_id', '')::uuid;
  exception when invalid_text_representation then
    v_tour_id := null;
  end;
  if v_tour_id is not null then
    select x.vorgefuellte_daten into vorgaben_alt from public.tour_protokoll_zuweisungen x
     where x.tour_id = v_tour_id and x.template_id = q.template_id;
    update public.tour_protokoll_zuweisungen z
       set template_id = p_ziel_template_id,
           vorgefuellte_daten = case when p_vorgefuellt is null then z.vorgefuellte_daten
                                     else p_vorgefuellt end
     where z.tour_id = v_tour_id
       and z.template_id = q.template_id
       and not exists (
         select 1 from public.tour_protokoll_zuweisungen x
          where x.tour_id = v_tour_id and x.template_id = p_ziel_template_id)
    returning z.id into zuw_id;
  end if;

  insert into public.formular_uebertragungen (
    quelle_id, ziel_id, quelle_template_id, ziel_template_id,
    quelle_template_name, ziel_template_name, von, von_name,
    anzahl_uebernommen, anzahl_verworfen, verworfen, unterschriften, hinweise, zuordnung,
    daten_bei_uebertragung, status_bei_uebertragung, umgestellt
  ) values (
    q.id, neu_id, q.template_id, p_ziel_template_id,
    alt_name, ziel_name, auth.uid(), ich_name,
    coalesce((p_protokoll->>'anzahl_uebernommen')::int, 0),
    coalesce((p_protokoll->>'anzahl_verworfen')::int, 0),
    coalesce(p_protokoll->'verworfen', '[]'::jsonb),
    coalesce(p_protokoll->'unterschriften', '[]'::jsonb),
    coalesce(p_protokoll->'hinweise', '[]'::jsonb),
    coalesce(p_protokoll->'zuordnung', '{}'::jsonb),
    p_daten, q.status::text,
    jsonb_build_object(
      'touren_ab', to_jsonb(touren_ab),
      'touren_bc', to_jsonb(touren_bc),
      'zuweisung_id', zuw_id,
      'zuweisung_vorgaben_alt', vorgaben_alt
    )
  );

  if p_merken then
    insert into public.template_zuordnungen (quelle_template_id, ziel_template_id, zuordnung, aktualisiert_von)
    values (q.template_id, p_ziel_template_id, coalesce(p_protokoll->'zuordnung', '{}'::jsonb), auth.uid())
    on conflict (quelle_template_id, ziel_template_id)
    do update set zuordnung = excluded.zuordnung, aktualisiert_am = now(),
                  aktualisiert_von = excluded.aktualisiert_von;
  end if;

  return neu_id;
end;
$$;

grant execute on function public.formular_uebertragen(uuid, uuid, jsonb, jsonb, jsonb, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. RPC: rückgängig
--
-- Nur solange das neue Formular unverändert ist: gleicher Stand wie
-- direkt nach der Übertragung, gleicher Status, noch keine PDFs.
-- ------------------------------------------------------------

create or replace function public.formular_uebertragung_rueckgaengig(p_ziel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.formular_uebertragungen%rowtype;
  z public.ausgefuellte_formulare%rowtype;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'Nur Admins dürfen Übertragungen rückgängig machen' using errcode = '42501';
  end if;

  select * into v from public.formular_uebertragungen
   where ziel_id = p_ziel_id and rueckgaengig_am is null
   order by id desc limit 1 for update;
  if not found then raise exception 'Keine rückgängig zu machende Übertragung gefunden'; end if;

  select * into z from public.ausgefuellte_formulare where id = p_ziel_id for update;
  if not found then raise exception 'Neues Formular nicht gefunden'; end if;
  if z.daten is distinct from v.daten_bei_uebertragung
     or z.status::text is distinct from v.status_bei_uebertragung then
    raise exception 'Das neue Formular wurde seit der Übertragung geändert — rückgängig nicht mehr möglich';
  end if;
  if coalesce(jsonb_array_length(z.pdf_paths), 0) > 0 then
    raise exception 'Für das neue Formular wurden bereits PDFs erzeugt — rückgängig nicht mehr möglich';
  end if;
  if exists (select 1 from public.ausgefuellte_formulare where uebertragen_von_id = z.id) then
    raise exception 'Das neue Formular wurde seinerseits weiter übertragen';
  end if;

  -- Touren und Zuweisung exakt zurückdrehen.
  update public.touren set eingang_id = v.quelle_id
   where eingang_id = z.id
     and id in (select (jsonb_array_elements_text(coalesce(v.umgestellt->'touren_ab', '[]'::jsonb)))::uuid);
  update public.touren set eingang_id_bc = v.quelle_id
   where eingang_id_bc = z.id
     and id in (select (jsonb_array_elements_text(coalesce(v.umgestellt->'touren_bc', '[]'::jsonb)))::uuid);
  if v.umgestellt ? 'zuweisung_id' and jsonb_typeof(v.umgestellt->'zuweisung_id') = 'string' then
    update public.tour_protokoll_zuweisungen x
       set template_id = v.quelle_template_id,
           vorgefuellte_daten = nullif(v.umgestellt->'zuweisung_vorgaben_alt', 'null'::jsonb)
     where x.id = (v.umgestellt->>'zuweisung_id')::uuid
       and x.template_id = v.ziel_template_id
       and not exists (
         select 1 from public.tour_protokoll_zuweisungen y
          where y.tour_id = x.tour_id and y.template_id = v.quelle_template_id);
  end if;

  update public.ausgefuellte_formulare
     set uebertragen_auf_id = null, uebertragen_am = null, uebertragen_von = null
   where id = v.quelle_id;

  update public.formular_uebertragungen
     set rueckgaengig_am = now(), rueckgaengig_von = auth.uid()
   where id = v.id;

  delete from public.ausgefuellte_formulare where id = z.id;
  return v.quelle_id;
end;
$$;

grant execute on function public.formular_uebertragung_rueckgaengig(uuid) to authenticated;

notify pgrst, 'reload schema';
