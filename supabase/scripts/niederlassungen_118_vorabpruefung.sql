-- Vorabprüfung für Migration 118 (Niederlassungen) — NUR LESEN.
-- VOR Migration 118 im Supabase-SQL-Editor ausführen.
-- Erwartung: Abfrage 1 = alles „ok", Abfragen 2–4 = keine Zeilen.
-- Abfragen 5 und 6 sind nur Übersichten (zur Info / Entscheidung).

-- 1) Voraussetzungen
select t.punkt, case when t.ok then 'ok' else 'FEHLT' end as status
  from (values
    ('Migration 116 eingespielt (Trigger rechnung_erstellen_snapshot)', exists (select 1 from pg_trigger where tgname = 'rechnung_erstellen_snapshot')),
    ('Migration 117 eingespielt (Tabelle erechnung_exporte)', to_regclass('public.erechnung_exporte') is not null),
    ('Funktion touch_updated_at()', exists (select 1 from pg_proc where proname = 'touch_updated_at')),
    ('Funktion is_auftraggeber() / current_auftraggeber_id()', exists (select 1 from pg_proc where proname = 'is_auftraggeber') and exists (select 1 from pg_proc where proname = 'current_auftraggeber_id')),
    ('Kundensicht touren_kundensicht vorhanden', to_regclass('public.touren_kundensicht') is not null),
    ('RPCs ag_tour_anlegen / ag_tour_aktualisieren vorhanden', exists (select 1 from pg_proc where proname = 'ag_tour_anlegen') and exists (select 1 from pg_proc where proname = 'ag_tour_aktualisieren'))
  ) as t(punkt, ok);

-- 2) Was 118 anlegt, aber schon existiert (kein Fehler — die Migration ist
--    wiederholbar —, aber bitte melden, falls 118 noch nie lief)
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (('auftraggeber','hauptsitz_bezeichnung'), ('touren','niederlassung_id'),
                                     ('rechnungen','niederlassung_id'), ('gutschriften','niederlassung_id'))
union all
select 'auftraggeber_niederlassungen', '(Tabelle)' where to_regclass('public.auftraggeber_niederlassungen') is not null;

-- 3) Gleichnamige Trigger/Funktionen
select 'trigger' as art, tgname as name from pg_trigger
 where tgname in ('touren_niederlassung_pruefen', 'rechnungen_niederlassung_pruefen', 'gutschriften_niederlassung_pruefen', 'auftraggeber_niederlassungen_touch')
union all
select 'funktion', proname from pg_proc where proname in ('niederlassung_pruefen', 'auftraggeber_anzeige');

-- 4) Die Kundensicht hat Spalten, die 118 nicht kennt (dann wurde sie nach
--    087 noch einmal geändert — 118 baut sie auf dem Stand von 087 neu auf)
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'touren_kundensicht'
   and column_name not in ('id','tour_id','start_stadt','ziel_stadt','rueckfuehrung_stadt','kundenname','auftraggeber_id',
     'startdatum','enddatum','tourenart','kennzeichen','ist_e_fahrzeug','fin','fin_rueck','fahrzeugmodell','fahrzeugmodell_rueck',
     'zeit_start','zeit_ziel','zeit_rueckfuehrung','km_hin','km_rueck','km_gesamt','adresse_start','adresse_ziel','adresse_rueckfuehrung',
     'strasse_start','plz_start','strasse_ziel','plz_ziel','strasse_rueckfuehrung','plz_rueckfuehrung','kontakt_start','kontakt_ziel',
     'kontakt_rueckfuehrung','protokoll_art','info','auf_eis','auf_eis_notiz','auf_eis_seit','bestaetigt','erstellt_von','created_at',
     'abgelehnt','ablehnungsgrund','abgelehnt_am','ablehnung_bestaetigt_am','eingang_id','eingang_id_bc','abgerechnet','niederlassung_id');

-- 5) Zur Info: Auftraggeber mit gleichem Namen (heute schon doppelt angelegt?
--    Solche Paare könnten später als Niederlassung zusammengeführt werden —
--    118 ändert daran NICHTS)
select lower(btrim(name)) as name, count(*) as anzahl, string_agg(coalesce(ort, '—'), ', ') as orte
  from public.auftraggeber group by lower(btrim(name)) having count(*) > 1;

-- 6) Zur Info: vorhandene Rechnungsadressen je Auftraggeber (Adressvorlagen
--    für Rechnungen; bleiben unverändert und werden NICHT zu Niederlassungen)
select a.name as auftraggeber, ra.firma, ra.plz_ort, ra.ansprechpartner, ra.ist_standard
  from public.rechnungsadressen ra join public.auftraggeber a on a.id = ra.auftraggeber_id
 order by a.name, ra.ist_standard desc;
