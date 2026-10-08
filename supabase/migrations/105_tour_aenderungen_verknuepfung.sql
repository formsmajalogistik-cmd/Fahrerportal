-- Änderungsprotokoll der Tour: auch Admin-Übernahmen beim Verknüpfen.
--
-- Anlass: Beim Verknüpfen eines Protokolls mit einer bestehenden Tour
-- darf der Admin jetzt abweichende Fahrzeugdaten (Kennzeichen, FIN,
-- Modell) aus dem Protokoll übernehmen, und nach der km-Übernahme wird
-- der Preis neu berechnet. Beides überschreibt Werte, die vorher auf der
-- Tour standen — das muss nachvollziehbar bleiben („Kennzeichen
-- HH-XX 999 → HH-AB 1234 beim Verknüpfen übernommen").
--
-- Dafür wird das bestehende Protokoll `tour_aenderungen` (Migration 079,
-- bisher nur Auftraggeber-Änderungen) um eine Quelle erweitert:
--   * 'auftraggeber'  — wie bisher, von ag_tour_aktualisieren() & Co.
--   * 'verknuepfung'  — vom Admin beim Verknüpfen eines Protokolls.
-- Bestehende Zeilen und die bestehenden RPCs bekommen über den Default
-- automatisch 'auftraggeber' — an ihnen ändert sich nichts.
--
-- Admin-Einträge werden direkt als gesehen geschrieben (gesehen_am), damit
-- sie nicht als „Vom Auftraggeber geändert — noch nicht quittiert"
-- auftauchen. Das macht der Client; die Spalten gibt es schon.
--
-- Schreiben: bisher gab es nur select/update/delete für authenticated
-- (geschrieben hat ausschließlich die DEFINER-RPC). Jetzt zusätzlich
-- insert — die Policy tour_aenderungen_admin_all (is_admin()) bleibt die
-- harte Grenze; die Test-Rolle ist kein Admin und darf weiter nichts.
--
-- Idempotent.

alter table public.tour_aenderungen
  add column if not exists quelle text not null default 'auftraggeber';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tour_aenderungen_quelle_check'
      and conrelid = 'public.tour_aenderungen'::regclass
  ) then
    alter table public.tour_aenderungen
      add constraint tour_aenderungen_quelle_check
      check (quelle in ('auftraggeber', 'verknuepfung'));
  end if;
end $$;

comment on column public.tour_aenderungen.quelle is
  'Woher die Änderung kommt: auftraggeber (AG-Bearbeitung, quittierpflichtig) '
  'oder verknuepfung (Admin übernimmt beim Verknüpfen Daten aus dem Protokoll).';

create index if not exists idx_tour_aenderungen_tour_zeit
  on public.tour_aenderungen(tour_id, geaendert_am desc);

grant insert on public.tour_aenderungen to authenticated;
