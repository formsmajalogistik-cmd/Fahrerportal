-- Migration 088: Rechnungen und Gutschriften an manuelle Empfänger
--
-- Bisher war ein Auftraggeber Pflicht. Für Subunternehmer, Fahrer oder
-- Privatpersonen soll ohne Auftraggeber abgerechnet werden können —
-- und der Empfänger darf NICHT in der Auftraggeber-Tabelle landen,
-- sonst taucht er in Listen, Filtern und Tour-Dropdowns auf.
--
-- Datenhaltung
-- ------------
-- Die Empfängerdaten liegen im schon vorhandenen Adress-Snapshot:
--   * rechnungen  → die flachen Spalten rechnungsadresse_* /
--                   ansprechpartner / kundennummer (seit 041). Ein
--                   jsonb-`adress_snapshot` gibt es dort NICHT; die
--                   flachen Spalten sind das Äquivalent und hängen
--                   bereits an PDF, E-Mail und Detailansicht.
--   * gutschriften → adress_snapshot (jsonb, seit 078).
-- Beide sind ohnehin frei editierbar; bei `empfaenger_typ = 'manuell'`
-- werden sie einfach direkt aus den Eingaben befüllt statt aus dem
-- Auftraggeber.
--
-- Neu sind nur die Felder, für die es bisher gar keinen Platz gab:
-- E-Mail (Versand-Vorbelegung) und USt-IdNr.
--
-- Die Nummernserie bleibt unangetastet — manuelle Rechnungen laufen in
-- derselben fortlaufenden Serie wie alle anderen.

-- ------------------------------------------------------------
-- 1. Rechnungen: Auftraggeber optional + Empfänger-Typ
-- ------------------------------------------------------------
alter table public.rechnungen
  alter column auftraggeber_id drop not null;

alter table public.rechnungen
  add column if not exists empfaenger_typ    text not null default 'auftraggeber',
  add column if not exists empfaenger_email  text,
  add column if not exists empfaenger_ust_id text;

alter table public.rechnungen drop constraint if exists rechnungen_empfaenger_typ_check;
alter table public.rechnungen add constraint rechnungen_empfaenger_typ_check
  check (empfaenger_typ in ('auftraggeber', 'manuell'));

-- Konsistenz: ohne "manuell" bleibt der Auftraggeber Pflicht. Damit
-- kann eine reguläre Rechnung nicht versehentlich ohne Auftraggeber
-- entstehen. Bestandsdaten erfüllen die Bedingung (typ = Default,
-- auftraggeber_id gesetzt), der Constraint wird direkt validiert.
alter table public.rechnungen drop constraint if exists rechnungen_empfaenger_konsistent;
alter table public.rechnungen add constraint rechnungen_empfaenger_konsistent
  check (empfaenger_typ = 'manuell' or auftraggeber_id is not null);

comment on column public.rechnungen.empfaenger_typ is
  'auftraggeber = regulär (auftraggeber_id gesetzt); manuell = freier '
  'Empfänger, Adresse ausschließlich aus den rechnungsadresse_*-Spalten.';

-- ------------------------------------------------------------
-- 2. Gutschriften: dieselben Felder (auftraggeber_id ist dort schon
--    nullable, siehe 078).
-- ------------------------------------------------------------
alter table public.gutschriften
  add column if not exists empfaenger_typ    text not null default 'auftraggeber',
  add column if not exists empfaenger_email  text,
  add column if not exists empfaenger_ust_id text;

alter table public.gutschriften drop constraint if exists gutschriften_empfaenger_typ_check;
alter table public.gutschriften add constraint gutschriften_empfaenger_typ_check
  check (empfaenger_typ in ('auftraggeber', 'manuell'));

-- ------------------------------------------------------------
-- 3. Gemerkte manuelle Empfänger
--
--    BEWUSST eine eigene Tabelle, getrennt von `auftraggeber`: nur so
--    bleibt garantiert, dass diese Empfänger nirgends in der
--    Auftraggeber-Logik auftauchen (Listen, Filter, Tour-Dropdowns,
--    Preislisten, Kundensicht). Es gibt keinen FK von den Rechnungen
--    hierher — die Rechnung trägt ihren Snapshot selbst, ein
--    gelöschter Merk-Eintrag verändert ausgestellte Dokumente also
--    nicht.
-- ------------------------------------------------------------
create table if not exists public.manuelle_empfaenger (
  id           uuid primary key default gen_random_uuid(),
  firma        text,
  anrede       text,
  vorname      text,
  nachname     text,
  strasse      text,
  plz          text,
  ort          text,
  land         text,
  email        text,
  ust_id       text,
  kundennummer text,
  notiz        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.manuelle_empfaenger is
  'Gemerkte Empfänger für manuelle Rechnungen/Gutschriften (z.B. '
  'Subunternehmer). Admin-only und bewusst getrennt von auftraggeber — '
  'diese Einträge erscheinen in keiner Auftraggeber-Ansicht.';

create index if not exists idx_manuelle_empfaenger_nachname
  on public.manuelle_empfaenger (nachname);

drop trigger if exists manuelle_empfaenger_updated_at on public.manuelle_empfaenger;
create trigger manuelle_empfaenger_updated_at
  before update on public.manuelle_empfaenger
  for each row execute function public.touch_updated_at();

alter table public.manuelle_empfaenger enable row level security;

-- Admin-only, wie Rechnungen und Gutschriften. Auftraggeber- und
-- Fahrer-Konten haben keinerlei Zugriff.
drop policy if exists manuelle_empfaenger_admin_all on public.manuelle_empfaenger;
create policy manuelle_empfaenger_admin_all on public.manuelle_empfaenger
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.manuelle_empfaenger to authenticated;

notify pgrst, 'reload schema';
