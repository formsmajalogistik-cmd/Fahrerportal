-- Migration 091: Briefe, Brief-Vorlagen und Tankkarten
--
-- Hauptfall ist die Überlassung von Tankkarten an Fahrer; frei
-- formulierte Briefe sind ebenso möglich.
--
-- Bewusst nah am Rechnungsmodul gebaut: eigener Adress-Snapshot als
-- jsonb (wie Gutschriften, 078), eigene Nummernserie mit
-- Advisory-Lock (wie 078), PDF im selben Layout, E-Mail über denselben
-- Weg. Damit bleiben Design und Verhalten konsistent.
--
-- Zwei Ergänzungen gegenüber der Vorgabe, jeweils weil es sonst nicht
-- funktioniert:
--   * `briefe.unterschrift_bild` — die erfasste Unterschrift muss
--     gespeichert werden, um sie in die signierte PDF einzubetten.
--     Die Vorgabe nennt nur pdf_signiert_url und unterschrieben_am.
--   * Adressfelder auf `app_users` — "Adresse aus dem Fahrerprofil
--     übernehmen" ging bisher nicht: weder app_users noch fahrer hatten
--     welche.

-- ------------------------------------------------------------
-- 0. Adresse im Nutzerprofil (für Empfänger-Typ "fahrer")
-- ------------------------------------------------------------
alter table public.app_users
  add column if not exists strasse text,
  add column if not exists plz     text,
  add column if not exists ort     text;

-- ------------------------------------------------------------
-- 1. Vorlagen
-- ------------------------------------------------------------
create table if not exists public.brief_vorlagen (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  betreff    text,
  inhalt     text,
  typ        text not null default 'allgemein',
  unterschrift_erforderlich boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brief_vorlagen drop constraint if exists brief_vorlagen_typ_check;
alter table public.brief_vorlagen add constraint brief_vorlagen_typ_check
  check (typ in ('allgemein', 'tankkarte'));

-- ------------------------------------------------------------
-- 2. Briefe
-- ------------------------------------------------------------
create table if not exists public.briefe (
  id                    uuid primary key default gen_random_uuid(),
  brief_nr              text not null unique,
  vorlage_id            uuid references public.brief_vorlagen(id) on delete set null,
  empfaenger_typ        text not null default 'manuell',
  fahrer_id             uuid references public.fahrer(id) on delete set null,
  adress_snapshot       jsonb,
  datum                 date not null default current_date,
  betreff               text,
  inhalt                text,
  status                text not null default 'entwurf',
  pdf_url               text,
  pdf_signiert_url      text,
  -- Erfasste Unterschrift als Data-URL. Ohne sie ließe sich die
  -- signierte PDF nicht erzeugen.
  unterschrift_bild     text,
  an_fahrer_gesendet_am timestamptz,
  unterschrieben_am     timestamptz,
  email_versendet_am    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.briefe drop constraint if exists briefe_empfaenger_typ_check;
alter table public.briefe add constraint briefe_empfaenger_typ_check
  check (empfaenger_typ in ('manuell', 'fahrer'));

alter table public.briefe drop constraint if exists briefe_status_check;
alter table public.briefe add constraint briefe_status_check
  check (status in ('entwurf', 'final', 'versendet', 'unterschrieben'));

-- In die App senden geht nur an einen Fahrer der App.
alter table public.briefe drop constraint if exists briefe_fahrer_konsistent;
alter table public.briefe add constraint briefe_fahrer_konsistent
  check (empfaenger_typ = 'manuell' or fahrer_id is not null);

create index if not exists idx_briefe_fahrer on public.briefe (fahrer_id);
create index if not exists idx_briefe_datum  on public.briefe (datum desc);
create index if not exists idx_briefe_status on public.briefe (status);

-- ------------------------------------------------------------
-- 3. Tankkarten
-- ------------------------------------------------------------
create table if not exists public.tankkarten (
  id            uuid primary key default gen_random_uuid(),
  anbieter      text,
  kartennummer  text not null,
  fahrer_id     uuid references public.fahrer(id) on delete set null,
  brief_id      uuid references public.briefe(id) on delete set null,
  ausgegeben_am date,
  zurueck_am    date,
  status        text not null default 'aktiv',
  notiz         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.tankkarten drop constraint if exists tankkarten_status_check;
alter table public.tankkarten add constraint tankkarten_status_check
  check (status in ('aktiv', 'zurueckgegeben', 'gesperrt'));

create index if not exists idx_tankkarten_fahrer on public.tankkarten (fahrer_id);
create index if not exists idx_tankkarten_status on public.tankkarten (status);

-- updated_at-Trigger
drop trigger if exists brief_vorlagen_updated_at on public.brief_vorlagen;
create trigger brief_vorlagen_updated_at before update on public.brief_vorlagen
  for each row execute function public.touch_updated_at();
drop trigger if exists briefe_updated_at on public.briefe;
create trigger briefe_updated_at before update on public.briefe
  for each row execute function public.touch_updated_at();
drop trigger if exists tankkarten_updated_at on public.tankkarten;
create trigger tankkarten_updated_at before update on public.tankkarten
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 4. Nummernserie — eigene Serie, getrennt von Rechnungen und
--    Gutschriften. Aufbau wie next_gutschrift_nr (078), inklusive
--    Advisory-Lock gegen doppelte Nummern bei parallelen Inserts.
-- ------------------------------------------------------------
create or replace function public.brief_nummernformat()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim((value ->> 'nummernformat')), ''),
    'Br-{Nr}/{Jahr}'
  )
  from public.app_settings
  where key = 'brief_einstellungen'
  union all
  select 'Br-{Nr}/{Jahr}'
  limit 1;
$$;

create or replace function public.next_brief_nr(
  p_year integer default extract(year from current_date)::int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format text;
  v_prefix text;
  v_suffix text;
  v_split  int;
  v_next   int;
begin
  -- Eigener Lock-Präfix (66677 = "BRIE"), damit sich die Serien nicht
  -- gegenseitig blockieren.
  perform pg_advisory_xact_lock(66677000000 + p_year);

  v_format := replace(public.brief_nummernformat(), '{Jahr}', p_year::text);
  v_split := position('{Nr}' in v_format);
  if v_split = 0 then
    v_prefix := v_format;
    v_suffix := '';
  else
    v_prefix := substring(v_format from 1 for v_split - 1);
    v_suffix := substring(v_format from v_split + 4);
  end if;

  select coalesce(max(nr), 0) + 1 into v_next
  from (
    select nullif(
             regexp_replace(
               left(b.brief_nr, length(b.brief_nr) - length(v_suffix)),
               '^' || regexp_replace(v_prefix, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\])', '\\\1', 'g'),
               ''
             ),
             ''
           )::int as nr
      from public.briefe b
     where b.brief_nr like v_prefix || '%' || v_suffix
       -- Handgetippte Sondernummern dürfen den Zähler nicht kippen.
       and substring(
             left(b.brief_nr, length(b.brief_nr) - length(v_suffix))
             from length(v_prefix) + 1
           ) ~ '^[0-9]+$'
  ) s;

  return v_prefix || v_next::text || v_suffix;
end;
$$;

create or replace function public.assign_brief_nr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.brief_nr is not null and btrim(new.brief_nr) <> '' then
    return new;
  end if;
  new.brief_nr := public.next_brief_nr(
    extract(year from coalesce(new.datum, current_date))::int
  );
  return new;
end;
$$;

drop trigger if exists briefe_nr on public.briefe;
create trigger briefe_nr before insert on public.briefe
  for each row execute function public.assign_brief_nr();

revoke all on function public.next_brief_nr(integer) from public;
grant execute on function public.next_brief_nr(integer) to authenticated;
grant execute on function public.brief_nummernformat() to authenticated;

-- ------------------------------------------------------------
-- 5. RLS
--
-- Grundregel: Briefe, Vorlagen und Tankkarten sind Admin-only.
-- Einzige Ausnahme: ein Fahrer darf den ihm GESENDETEN Brief lesen.
-- Auftraggeber- und Test-Konten haben keinerlei Zugriff.
-- ------------------------------------------------------------
alter table public.brief_vorlagen enable row level security;
alter table public.briefe         enable row level security;
alter table public.tankkarten     enable row level security;

drop policy if exists brief_vorlagen_admin on public.brief_vorlagen;
create policy brief_vorlagen_admin on public.brief_vorlagen
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tankkarten_admin on public.tankkarten;
create policy tankkarten_admin on public.tankkarten
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists briefe_admin on public.briefe;
create policy briefe_admin on public.briefe
  for all using (public.is_admin()) with check (public.is_admin());

-- Fahrer: NUR lesen, nur den eigenen, nur wenn er auch gesendet wurde.
-- Bewusst KEINE UPDATE-Policy — die wäre zeilen-, nicht spaltenweit und
-- ließe den Fahrer den Brieftext ändern (Lehre aus 089). Das
-- Unterschreiben läuft ausschließlich über die RPC unten.
drop policy if exists briefe_fahrer_read on public.briefe;
create policy briefe_fahrer_read on public.briefe
  for select using (
    not public.is_admin()
    and not public.is_auftraggeber()
    and an_fahrer_gesendet_am is not null
    and fahrer_id is not null
    and fahrer_id in (select public.meine_fahrer_ids())
  );

grant select, insert, update, delete on public.brief_vorlagen to authenticated;
grant select, insert, update, delete on public.briefe          to authenticated;
grant select, insert, update, delete on public.tankkarten      to authenticated;

-- ------------------------------------------------------------
-- 6. Unterschreiben durch den Fahrer
--
--    Schreibt AUSSCHLIESSLICH Unterschrift, Zeitstempel und Status.
--    Betreff, Inhalt, Empfänger und Nummer bleiben unerreichbar.
-- ------------------------------------------------------------
create or replace function public.brief_unterschreiben(
  p_brief_id     uuid,
  p_unterschrift text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fahrer uuid;
  v_gesendet timestamptz;
  v_bereits timestamptz;
begin
  if p_brief_id is null or coalesce(btrim(p_unterschrift), '') = '' then
    return jsonb_build_object('ok', false, 'fehler', 'Bitte zuerst unterschreiben.');
  end if;
  -- Nur echte Bilddaten annehmen.
  if p_unterschrift not like 'data:image/%' then
    return jsonb_build_object('ok', false, 'fehler', 'Ungültige Unterschrift.');
  end if;

  select b.fahrer_id, b.an_fahrer_gesendet_am, b.unterschrieben_am
    into v_fahrer, v_gesendet, v_bereits
    from public.briefe b
   where b.id = p_brief_id;
  if not found then
    return jsonb_build_object('ok', false, 'fehler', 'Brief nicht gefunden.');
  end if;
  -- Besitzprüfung ZUERST: sonst verrät die Fehlermeldung einem
  -- Fremden, dass es den Brief gibt und ob er schon signiert ist.
  -- Nur der Empfänger selbst — Admins unterschreiben nicht für ihn.
  if v_fahrer is null or v_fahrer not in (select public.meine_fahrer_ids()) then
    return jsonb_build_object('ok', false, 'fehler', 'Dieser Brief ist nicht an Sie gerichtet.');
  end if;
  if v_gesendet is null then
    return jsonb_build_object('ok', false, 'fehler', 'Dieser Brief wurde noch nicht zugestellt.');
  end if;
  if v_bereits is not null then
    return jsonb_build_object('ok', false, 'fehler', 'Dieser Brief ist bereits unterschrieben.');
  end if;

  update public.briefe
     set unterschrift_bild = p_unterschrift,
         unterschrieben_am = now(),
         status = 'unterschrieben'
   where id = p_brief_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.brief_unterschreiben(uuid, text) from public;
grant execute on function public.brief_unterschreiben(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7. Startwerte
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
select 'brief_einstellungen',
       jsonb_build_object('nummernformat', 'Br-{Nr}/{Jahr}', 'dokumentbezeichnung', 'Brief')
 where not exists (select 1 from public.app_settings where key = 'brief_einstellungen');

insert into public.brief_vorlagen (name, typ, betreff, inhalt, unterschrift_erforderlich)
select
  'Tankkartenüberlassung', 'tankkarte',
  'Überlassung einer Tankkarte',
  E'{empfaenger_anrede}\n\n'
  || E'hiermit überlassen wir Ihnen die folgende Tankkarte zur '
  || E'dienstlichen Nutzung:\n\n'
  || E'Anbieter: {tankkarte_anbieter}\n'
  || E'Kartennummer: {tankkarte_nummer}\n'
  || E'Übergabe am: {datum}\n\n'
  || E'Die Karte ist ausschließlich für dienstliche Betankungen des '
  || E'Ihnen anvertrauten Fahrzeugs zu verwenden. Die zugehörige PIN ist '
  || E'getrennt von der Karte aufzubewahren und nicht an Dritte '
  || E'weiterzugeben. Verlust oder Diebstahl sind unverzüglich zu '
  || E'melden, damit die Karte gesperrt werden kann.\n\n'
  || E'Bei Beendigung des Einsatzes ist die Karte unaufgefordert '
  || E'zurückzugeben.\n\n'
  || E'Mit Ihrer Unterschrift bestätigen Sie den Empfang der Karte und '
  || E'die Kenntnisnahme dieser Bedingungen.',
  true
 where not exists (select 1 from public.brief_vorlagen where typ = 'tankkarte');

notify pgrst, 'reload schema';
