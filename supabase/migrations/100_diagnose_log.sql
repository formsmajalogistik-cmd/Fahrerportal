-- Diagnose-Protokoll für Fehler aus der Praxis.
--
-- Anlass: Die Schadensaufnahme (Skizze + Fotos) zeigt bei Fahrern
-- verschiedene Fehlerbilder, genaue Beschreibungen gibt es nicht. Ein
-- schlankes, dauerhaft mitlaufendes Protokoll technischer Ereignisse
-- macht nachvollziehbar, was auf dem Gerät tatsächlich passiert ist.
--
-- Bewusst KEINE Inhalte: keine Bilder, keine Formularwerte — nur
-- Ereignisname, Gerätekennung und technische Details (Maße, Anzahlen,
-- Fehlertexte). Die Begrenzung von `details` auf wenige KB verhindert,
-- dass versehentlich große Inhalte hineinwandern.
--
-- Zugriff: Jeder angemeldete Nutzer (außer der schreibgeschützten
-- Test-Rolle) darf EIGENE Einträge schreiben, lesen dürfen nur Admins.
-- Aufräumen: Einträge älter als 30 Tage verschwinden beim Schreiben — ohne
-- Zeitplaner, eine Löschabfrage über den Index auf created_at.

create table if not exists public.diagnose_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid(),
  fahrer_id   uuid,
  formular_id uuid,
  bereich     text not null default 'schadensaufnahme',
  ereignis    text not null,
  geraet      text,
  details     jsonb not null default '{}'::jsonb,
  constraint diagnose_log_ereignis_kurz check (length(ereignis) <= 80),
  constraint diagnose_log_geraet_kurz check (geraet is null or length(geraet) <= 400),
  constraint diagnose_log_details_klein check (pg_column_size(details) <= 4096)
);

create index if not exists diagnose_log_created_at_idx on public.diagnose_log (created_at desc);
create index if not exists diagnose_log_fahrer_idx     on public.diagnose_log (fahrer_id, created_at desc);
create index if not exists diagnose_log_formular_idx   on public.diagnose_log (formular_id, created_at desc);

alter table public.diagnose_log enable row level security;

drop policy if exists diagnose_log_insert_eigene on public.diagnose_log;
create policy diagnose_log_insert_eigene on public.diagnose_log
  for insert to authenticated
  with check (user_id = auth.uid() and not public.is_test());

drop policy if exists diagnose_log_admin_read on public.diagnose_log;
create policy diagnose_log_admin_read on public.diagnose_log
  for select using (public.is_admin());

drop policy if exists diagnose_log_admin_delete on public.diagnose_log;
create policy diagnose_log_admin_delete on public.diagnose_log
  for delete using (public.is_admin());

grant insert on public.diagnose_log to authenticated;
grant select, delete on public.diagnose_log to authenticated;

-- Aufräumen beim Schreiben. SECURITY DEFINER, weil der schreibende Fahrer
-- selbst nicht löschen darf. Statement-Trigger: einmal je Insert-Batch.
create or replace function public.diagnose_log_aufraeumen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.diagnose_log where created_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists diagnose_log_aufraeumen_trg on public.diagnose_log;
create trigger diagnose_log_aufraeumen_trg
  after insert on public.diagnose_log
  for each statement execute function public.diagnose_log_aufraeumen();

notify pgrst, 'reload schema';
