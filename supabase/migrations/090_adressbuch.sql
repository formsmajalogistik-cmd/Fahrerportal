-- Migration 090: Adressbuch + manuelle Vorschlags-Einträge
--
-- Warum eine EIGENE Tabelle statt Einträgen in `feld_vorschlaege`?
-- ---------------------------------------------------------------
-- `feld_vorschlaege` ist ein flacher Topf aus (feld_typ, wert). Eine
-- Adresse gehört aber als DREI zusammengehörige Werte gespeichert
-- (Straße, PLZ, Ort), damit die Auswahl alle drei Felder auf einmal
-- füllt. Das ließe sich dort nur als JSON-Wert hineinquetschen.
--
-- Dazu kommt die Datenschutz-Grenze: manuelle Adressen dürfen einem
-- Auftraggeber zugeordnet und dann NUR diesem gezeigt werden. Der
-- automatisch gesammelte Pool bleibt dagegen für Auftraggeber komplett
-- gesperrt (Migration 077). Beides in einer Tabelle hieße, zwei
-- gegensätzliche Sichtbarkeitsregeln in dieselbe Policy zu pressen.
--
-- Deshalb: eigene Tabelle `adressbuch` mit eigener RLS. `feld_vorschlaege`
-- bekommt lediglich ein `ist_manuell`-Kennzeichen, damit der Admin auch
-- die übrigen Töpfe (E-Mail, Kontaktname …) von Hand pflegen kann.

-- ------------------------------------------------------------
-- 1. Manuelle Einträge im bestehenden Pool
-- ------------------------------------------------------------
alter table public.feld_vorschlaege
  add column if not exists ist_manuell boolean not null default false;

comment on column public.feld_vorschlaege.ist_manuell is
  'Vom Admin von Hand angelegt statt aus einem Formular gesammelt. '
  'Wird in der Auswahl vor den gesammelten Werten angeboten.';

-- Bisher gab es nur select + delete (077) — Schreiben lief ausschließlich
-- über die RPC. Für die Pflege-Oberfläche darf der Admin jetzt auch
-- direkt anlegen und korrigieren. Fahrer und Auftraggeber ausdrücklich
-- NICHT: für sie bleibt die RPC der einzige Weg.
drop policy if exists fv_admin_write on public.feld_vorschlaege;
create policy fv_admin_write on public.feld_vorschlaege
  for insert with check (public.is_admin());

drop policy if exists fv_admin_update on public.feld_vorschlaege;
create policy fv_admin_update on public.feld_vorschlaege
  for update using (public.is_admin()) with check (public.is_admin());

grant insert, update on public.feld_vorschlaege to authenticated;

-- ------------------------------------------------------------
-- 2. Adressbuch
-- ------------------------------------------------------------
create table if not exists public.adressbuch (
  id              uuid primary key default gen_random_uuid(),
  bezeichnung     text,
  strasse         text,
  plz             text,
  ort             text,
  -- NULL = allgemeine Adresse (Admin + Fahrer). Gesetzt = zusätzlich
  -- für genau diesen Auftraggeber sichtbar.
  auftraggeber_id uuid references public.auftraggeber(id) on delete cascade,
  notiz           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.adressbuch is
  'Manuell gepflegte Adressen für die Auswahl in Formularen und der '
  'Tour-Erfassung. Getrennt von feld_vorschlaege, weil Straße/PLZ/Ort '
  'zusammengehören und weil hier eine Auftraggeber-Sichtbarkeit gilt.';
comment on column public.adressbuch.auftraggeber_id is
  'NULL = allgemein (Admin + Fahrer). Gesetzt = zusätzlich für diesen '
  'einen Auftraggeber sichtbar — niemals für andere.';

create index if not exists idx_adressbuch_auftraggeber
  on public.adressbuch (auftraggeber_id);
create index if not exists idx_adressbuch_ort on public.adressbuch (ort);

drop trigger if exists adressbuch_updated_at on public.adressbuch;
create trigger adressbuch_updated_at
  before update on public.adressbuch
  for each row execute function public.touch_updated_at();

alter table public.adressbuch enable row level security;

-- Pflege ausschließlich durch Admins.
drop policy if exists adressbuch_admin_all on public.adressbuch;
create policy adressbuch_admin_all on public.adressbuch
  for all using (public.is_admin()) with check (public.is_admin());

-- Interne Rollen (Admin, Fahrer, Test) sehen alle Adressen.
drop policy if exists adressbuch_intern_read on public.adressbuch;
create policy adressbuch_intern_read on public.adressbuch
  for select using (not public.is_auftraggeber());

-- Auftraggeber sehen AUSSCHLIESSLICH die ihnen zugeordneten Adressen.
-- Kein Zugriff auf allgemeine Adressen und erst recht nicht auf die
-- anderer Kunden — durchgesetzt hier, nicht im Frontend.
drop policy if exists adressbuch_ag_read on public.adressbuch;
create policy adressbuch_ag_read on public.adressbuch
  for select using (
    public.is_auftraggeber()
    and auftraggeber_id is not null
    and auftraggeber_id = public.current_auftraggeber_id()
  );

grant select, insert, update, delete on public.adressbuch to authenticated;

notify pgrst, 'reload schema';
