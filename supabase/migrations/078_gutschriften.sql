-- ============================================================
-- Maja-Logistik Business-Portal — 078: Gutschriften
-- ------------------------------------------------------------
-- Rechnungskorrekturen als eigenes, schlankeres Dokument neben den
-- Rechnungen. Bewusste Unterschiede zum Rechnungsmodul:
--   * Eigene Nummernserie (NICHT der Rechnungs-Zähler).
--   * Nur zwei Status: 'entwurf' | 'final'. Kein "bezahlt", keine
--     Zahlungsverfolgung.
--   * Optionaler Bezug zu einer Rechnung (Teilgutschrift möglich).
--
-- Die Dokumentbezeichnung ("Gutschrift" / "Rechnungskorrektur" /
-- "Storno-Rechnung") und das Nummernformat sind in app_settings
-- konfigurierbar — der Steuerberater kann den Begriff vorgeben, ohne
-- dass Code angefasst wird.
--
-- RLS: nur Admins. Auftraggeber und Fahrer haben KEINEN Zugriff.
--
-- Idempotent.
-- ============================================================

create table if not exists public.gutschriften (
  id                     uuid primary key default gen_random_uuid(),
  gutschrift_nr          text not null unique,
  auftraggeber_id        uuid references public.auftraggeber(id) on delete restrict,
  rechnungsempfaenger_id uuid references public.auftraggeber_kontakte(id) on delete set null,
  rechnung_id            uuid references public.rechnungen(id) on delete set null,
  datum                  date not null default current_date,
  leistungszeitraum_von  date,
  leistungszeitraum_bis  date,
  anrede                 text,
  einleitungstext        text,
  schlusstext            text,
  interne_notizen        text,
  adress_snapshot        jsonb,
  kundennummer           text,
  sachbearbeiter         text,
  ust_satz               numeric not null default 19,
  netto_summe            numeric not null default 0,
  ust_summe              numeric not null default 0,
  brutto_summe           numeric not null default 0,
  status                 text not null default 'entwurf'
    check (status in ('entwurf', 'final')),
  pdf_url                text,
  email_versendet_am     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_gutschriften_auftraggeber on public.gutschriften(auftraggeber_id);
create index if not exists idx_gutschriften_rechnung     on public.gutschriften(rechnung_id);
create index if not exists idx_gutschriften_datum        on public.gutschriften(datum);

comment on table public.gutschriften is
  'Gutschriften / Rechnungskorrekturen. Eigene Nummernserie, Status nur '
  'entwurf|final, optionaler Bezug zu einer Rechnung. Admin-only.';
comment on column public.gutschriften.adress_snapshot is
  'Feste Empfänger-Adresse zum Zeitpunkt der Ausstellung: '
  '{firma, ansprechpartner, strasse, plz_ort, land}. Analog zu den '
  'rechnungsadresse_*-Spalten der Rechnungen — spätere Stammdaten-'
  'Änderungen dürfen ein ausgestelltes Dokument nicht verändern.';

drop trigger if exists gutschriften_updated_at on public.gutschriften;
create trigger gutschriften_updated_at
  before update on public.gutschriften
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
create table if not exists public.gutschriftspositionen (
  id            uuid primary key default gen_random_uuid(),
  gutschrift_id uuid not null references public.gutschriften(id) on delete cascade,
  position_nr   integer not null default 1,
  bezeichnung   text not null default '',
  unterzeilen   jsonb not null default '[]'::jsonb,
  menge         numeric not null default 1,
  einzelpreis   numeric not null default 0,
  gesamtpreis   numeric not null default 0,
  ust_satz      numeric,
  tour_id       uuid references public.touren(id) on delete set null,
  ist_manuell   boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_gutschriftspositionen_gutschrift
  on public.gutschriftspositionen(gutschrift_id);

-- ------------------------------------------------------------
-- Nummernserie
-- ------------------------------------------------------------
-- Format frei konfigurierbar in app_settings unter dem Key
-- 'gutschrift_einstellungen' → {"nummernformat": "GS-{Jahr}/{Nr}"}.
-- Aus dem Format wird ein Präfix/Suffix gebaut; die laufende Nummer
-- ist alles zwischen beidem.
--
-- SECURITY DEFINER — die Vergabe darf NICHT von der RLS-Sicht des
-- Aufrufers abhängen (Lehre aus der Tour-ID, Migration 073): sonst
-- liefert max() unter einer eingeschränkten Sicht eine bereits
-- vergebene Nummer. Zusätzlich schützt der UNIQUE-Constraint auf
-- gutschrift_nr vor Duplikaten.
-- ------------------------------------------------------------
create or replace function public.gutschrift_nummernformat()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim((value ->> 'nummernformat')), ''),
    'GS-{Jahr}/{Nr}'
  )
  from public.app_settings
  where key = 'gutschrift_einstellungen'
  union all
  select 'GS-{Jahr}/{Nr}'
  limit 1;
$$;

create or replace function public.next_gutschrift_nr(
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
  -- Ein Lock pro Jahr (Präfix 78477 = "GUTS"), damit zwei parallele
  -- Vorschauen/Inserts nicht dieselbe Nummer melden.
  perform pg_advisory_xact_lock(78477000000 + p_year);

  v_format := replace(public.gutschrift_nummernformat(), '{Jahr}', p_year::text);
  v_split := position('{Nr}' in v_format);
  if v_split = 0 then
    -- Format ohne {Nr}: laufende Nummer hinten anhängen.
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
               left(g.gutschrift_nr, length(g.gutschrift_nr) - length(v_suffix)),
               '^' || regexp_replace(v_prefix, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\])', '\\\1', 'g'),
               ''
             ),
             ''
           )::int as nr
      from public.gutschriften g
     where g.gutschrift_nr like v_prefix || '%' || v_suffix
       -- Nur Einträge, bei denen der Mittelteil rein numerisch ist —
       -- eine handgetippte Sondernummer soll den Zähler nicht kippen.
       and substring(
             left(g.gutschrift_nr, length(g.gutschrift_nr) - length(v_suffix))
             from length(v_prefix) + 1
           ) ~ '^[0-9]+$'
  ) s;

  return v_prefix || v_next::text || v_suffix;
end;
$$;

create or replace function public.assign_gutschrift_nr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gutschrift_nr is not null and btrim(new.gutschrift_nr) <> '' then
    return new;
  end if;
  new.gutschrift_nr := public.next_gutschrift_nr(
    extract(year from coalesce(new.datum, current_date))::int
  );
  return new;
end;
$$;

drop trigger if exists gutschriften_assign_nr on public.gutschriften;
create trigger gutschriften_assign_nr
  before insert on public.gutschriften
  for each row execute function public.assign_gutschrift_nr();

revoke all on function public.gutschrift_nummernformat() from public;
revoke all on function public.next_gutschrift_nr(integer) from public;
grant execute on function public.next_gutschrift_nr(integer) to authenticated;

-- ------------------------------------------------------------
-- RLS: ausschließlich Admins (wie bei den Rechnungen).
-- ------------------------------------------------------------
alter table public.gutschriften          enable row level security;
alter table public.gutschriftspositionen enable row level security;

drop policy if exists gutschriften_admin_all on public.gutschriften;
create policy gutschriften_admin_all on public.gutschriften
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gutschriftspositionen_admin_all on public.gutschriftspositionen;
create policy gutschriftspositionen_admin_all on public.gutschriftspositionen
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete
  on public.gutschriften, public.gutschriftspositionen to authenticated;

-- ------------------------------------------------------------
-- Default-Einstellungen, damit die Settings-Seite nicht leer startet.
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
values (
  'gutschrift_einstellungen',
  jsonb_build_object(
    'dokumentbezeichnung', 'Gutschrift',
    'nummernformat',       'GS-{Jahr}/{Nr}',
    'einleitungstext',     'wir schreiben Ihnen folgende Positionen gut:',
    'schlusstext',         'Der Betrag wird Ihrem Konto gutgeschrieben bzw. mit der nächsten Rechnung verrechnet.',
    'summen_label',        'Gutschriftbetrag'
  )
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
