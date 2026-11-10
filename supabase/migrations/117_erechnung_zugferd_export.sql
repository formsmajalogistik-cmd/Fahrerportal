-- E-Rechnung, Phase 1c: ZUGFeRD-Ablage, Protokoll, Archiv-Export.
--
-- Additiv und idempotent. Bestehende Belege und Archiv-Einträge werden
-- NICHT verändert.
--
--  1. erechnung_dokumente.protokoll — Vermerk des Servers beim Ablegen
--     (z.B. „verwaiste Datei aus früherem Versuch beiseitegelegt als …").
--  2. erechnung_dokumente.xml_pfad darf leer sein: bei ZUGFeRD gibt es
--     nur EINE Datei (PDF/A-3 mit eingebettetem XML); sha256_xml ist dann
--     der Hash des eingebetteten XML.
--  3. erechnung_exporte — wann welcher Archiv-Eintrag exportiert wurde
--     (nur INSERT; erechnung_dokumente selbst bleibt unveränderlich).
--  4. Format 'zugferd' war in den Prüfregeln schon vorgesehen (115/116).

-- ------------------------------------------------------------
-- 1./2. Archiv-Verzeichnis
-- ------------------------------------------------------------
alter table public.erechnung_dokumente add column if not exists protokoll text;
alter table public.erechnung_dokumente alter column xml_pfad drop not null;
alter table public.erechnung_dokumente drop constraint if exists erechnung_dokumente_xml_pfad_check;
alter table public.erechnung_dokumente add constraint erechnung_dokumente_xml_pfad_check
  check (format = 'zugferd' or xml_pfad is not null);
comment on column public.erechnung_dokumente.protokoll is
  'Vermerk des Servers beim Ablegen (Wiederverwendung identischer Dateien, beiseitegelegte verwaiste Dateien). NULL = normaler Ablauf.';
comment on column public.erechnung_dokumente.xml_pfad is
  'OneDrive-Pfad der XML-Datei; NULL bei ZUGFeRD (XML ist im PDF eingebettet, pdf_pfad ist die maßgebliche Datei).';

-- ------------------------------------------------------------
-- 3. Export-Protokoll
-- ------------------------------------------------------------
create table if not exists public.erechnung_exporte (
  id                 uuid primary key default gen_random_uuid(),
  dokument_id        uuid not null references public.erechnung_dokumente(id) on delete restrict,
  exportiert_am      timestamptz not null default now(),
  exportiert_von     uuid default auth.uid(),
  exportiert_von_name text,
  -- Ergebnis der Hash-Prüfung beim Export (false = Abweichung gemeldet)
  hash_ok            boolean not null,
  hinweis            text
);
create index if not exists idx_erechnung_exporte_dokument on public.erechnung_exporte (dokument_id, exportiert_am desc);
comment on table public.erechnung_exporte is
  'Protokoll des Archiv-Exports: je exportiertem Archiv-Eintrag eine Zeile (wann, wer, Hash-Prüfung). Nur INSERT.';

alter table public.erechnung_exporte enable row level security;
drop policy if exists erechnung_exporte_lesen on public.erechnung_exporte;
create policy erechnung_exporte_lesen on public.erechnung_exporte
  for select using (public.is_admin());
drop policy if exists erechnung_exporte_einfuegen on public.erechnung_exporte;
create policy erechnung_exporte_einfuegen on public.erechnung_exporte
  for insert with check (public.is_admin() and not public.is_test() and exportiert_von = auth.uid());
revoke all on public.erechnung_exporte from anon, authenticated;
grant select, insert on public.erechnung_exporte to authenticated;

create or replace function public.erechnung_exporte_unveraenderlich()
returns trigger language plpgsql as $$
begin
  raise exception 'ERECHNUNG_EXPORT: Das Export-Protokoll kann nicht geändert oder gelöscht werden.' using errcode = '42501';
end;
$$;
drop trigger if exists erechnung_exporte_kein_update on public.erechnung_exporte;
create trigger erechnung_exporte_kein_update
  before update or delete on public.erechnung_exporte
  for each row execute function public.erechnung_exporte_unveraenderlich();

notify pgrst, 'reload schema';
