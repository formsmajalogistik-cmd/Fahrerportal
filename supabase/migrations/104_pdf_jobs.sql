-- PDF-Erzeugung als Auftrag mit Teilstatus („Job-Modell").
--
-- Anlass: „PDFs erzeugen" in Eingänge lief komplett im Browser, Teil für
-- Teil. Wechselte der Admin direkt den Tab (oder lag die App im
-- Hintergrund), drosselte/pausierte der Browser den Ablauf — er brach an
-- einer zufälligen Stelle ab: nichts / nur das Protokoll / alles. Schlimmer:
-- gescheiterte Teile wurden still übersprungen, die Gesamt-PDF entstand
-- ohne sie, und am Ende stand trotzdem pdf_status = 'ok'.
--
-- Jetzt führt jede Erzeugung einen Auftrag mit Status je PDF-Teil. Erst
-- wenn alle Teile fertig sind, ist der Auftrag `fertig`; ein Teilstand ist
-- `teilweise` und lässt sich fortsetzen — nur die fehlenden Teile werden
-- erzeugt. Pro Formular gibt es höchstens EINEN offenen Auftrag
-- (Doppelstarts waren die Ursache des früheren 409 nameAlreadyExists).
--
-- Ein Tab „beansprucht" den Auftrag für 60 s und verlängert das, solange
-- er arbeitet. Wird der Tab geschlossen, läuft die Beanspruchung ab, und
-- der Auftrag kann (auch aus einem anderen Tab) fortgesetzt werden.
-- Die Zeitvergleiche laufen über die Server-Uhr (RPCs), nicht die des
-- Browsers.

create table if not exists public.pdf_jobs (
  id              uuid primary key default gen_random_uuid(),
  formular_id     uuid not null references public.ausgefuellte_formulare(id) on delete cascade,
  gestartet_am    timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  gestartet_von   uuid default auth.uid(),
  status          text not null default 'laeuft'
                  check (status in ('laeuft', 'teilweise', 'fertig', 'fehlgeschlagen', 'verworfen')),
  -- [{pdf_id, name, status: offen|fertig|uebersprungen|fehler, filename?, onedrive_path?, fehler?, grund?}]
  teile           jsonb not null default '[]'::jsonb,
  zusammenfuehren boolean not null default false,
  -- Gesamt-PDF im Merge-Modus: {status, filename?, onedrive_path?, fehler?}
  gesamt          jsonb,
  halter          text,
  lease_bis       timestamptz,
  fehler          text
);

-- Höchstens ein offener Auftrag je Formular.
create unique index if not exists pdf_jobs_ein_offener_je_formular
  on public.pdf_jobs (formular_id) where status in ('laeuft', 'teilweise');
create index if not exists pdf_jobs_formular_idx
  on public.pdf_jobs (formular_id, gestartet_am desc);

alter table public.pdf_jobs enable row level security;

drop policy if exists pdf_jobs_admin_all on public.pdf_jobs;
create policy pdf_jobs_admin_all on public.pdf_jobs
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists pdf_jobs_test_read on public.pdf_jobs;
create policy pdf_jobs_test_read on public.pdf_jobs
  for select using (public.is_test());

grant select, insert, update on public.pdf_jobs to authenticated;

-- Beanspruchen: nur wenn der Auftrag offen ist und niemand anderes ihn
-- gerade (gültig) hält. Liefert true, wenn dieser Tab jetzt der Halter ist.
create or replace function public.pdf_job_beanspruchen(p_job uuid, p_halter text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare n int;
begin
  update public.pdf_jobs
     set halter = p_halter, lease_bis = now() + interval '60 seconds',
         status = 'laeuft', aktualisiert_am = now(), fehler = null
   where id = p_job
     and status in ('laeuft', 'teilweise')
     and (halter = p_halter or lease_bis is null or lease_bis < now());
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Lebenszeichen des arbeitenden Tabs: verlängert die Beanspruchung.
-- false = der Tab hat den Auftrag verloren (abgelaufen und übernommen).
create or replace function public.pdf_job_puls(p_job uuid, p_halter text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare n int;
begin
  update public.pdf_jobs
     set lease_bis = now() + interval '60 seconds', aktualisiert_am = now()
   where id = p_job and halter = p_halter and status = 'laeuft';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

grant execute on function public.pdf_job_beanspruchen(uuid, text) to authenticated;
grant execute on function public.pdf_job_puls(uuid, text) to authenticated;

notify pgrst, 'reload schema';
