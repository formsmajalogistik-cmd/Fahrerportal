-- Vorabprüfung für Migration 115 (E-Rechnung) — NUR LESEN.
--
-- VOR Migration 115 im Supabase-SQL-Editor ausführen. Prüft, ob das echte
-- Schema so aussieht, wie die Migration es erwartet (Tabellen vorhanden,
-- keine gleichnamigen Spalten/Constraints/Trigger mit anderer Bedeutung).
-- Erwartung: Abfrage 1 = alle „vorhanden", Abfragen 2–4 = keine Zeilen.

-- 1) Benötigte Tabellen und Spalten, auf die die Migration aufbaut
select t.name as tabelle_oder_spalte,
       case when t.vorhanden then 'vorhanden' else 'FEHLT' end as status
  from (values
    ('rechnungen',                    to_regclass('public.rechnungen') is not null),
    ('rechnungspositionen',           to_regclass('public.rechnungspositionen') is not null),
    ('auftraggeber',                  to_regclass('public.auftraggeber') is not null),
    ('rechnungsadressen',             to_regclass('public.rechnungsadressen') is not null),
    ('manuelle_empfaenger',           to_regclass('public.manuelle_empfaenger') is not null),
    ('rechnungen.status',             exists (select 1 from information_schema.columns where table_schema='public' and table_name='rechnungen' and column_name='status')),
    ('rechnungen.datum',              exists (select 1 from information_schema.columns where table_schema='public' and table_name='rechnungen' and column_name='datum')),
    ('rechnungen.empfaenger_typ',     exists (select 1 from information_schema.columns where table_schema='public' and table_name='rechnungen' and column_name='empfaenger_typ')),
    ('auftraggeber.zahlungsziel_tage',exists (select 1 from information_schema.columns where table_schema='public' and table_name='auftraggeber' and column_name='zahlungsziel_tage'))
  ) as t(name, vorhanden);

-- 2) Spalten, die die Migration anlegt, aber schon existieren
--    (wäre unerwartet — dann bitte melden, bevor 115 läuft)
select table_name as tabelle, column_name as spalte, data_type as typ
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('rechnungen','faellig_am'), ('rechnungen','zahlungsziel_tage'),
     ('rechnungen','rechnungsadresse_plz'), ('rechnungen','rechnungsadresse_ort'),
     ('rechnungen','rechnungsadresse_land_code'), ('rechnungen','erechnung_format'),
     ('rechnungen','erechnung_email'), ('rechnungen','kaeufer_referenz'),
     ('auftraggeber','land_code'), ('auftraggeber','erechnung_format'),
     ('auftraggeber','erechnung_email'), ('auftraggeber','kaeufer_referenz'),
     ('rechnungsadressen','plz'), ('rechnungsadressen','ort'), ('rechnungsadressen','land_code'),
     ('manuelle_empfaenger','land_code'), ('manuelle_empfaenger','zahlungsziel_tage'),
     ('manuelle_empfaenger','erechnung_format'), ('manuelle_empfaenger','erechnung_email'),
     ('manuelle_empfaenger','kaeufer_referenz'),
     ('rechnungspositionen','einheit_code'), ('rechnungspositionen','steuerkategorie'),
     ('rechnungspositionen','befreiungsgrund_code'), ('rechnungspositionen','befreiungsgrund_text'));

-- 3) Gleichnamige Constraints
select conname as constraint_name, conrelid::regclass as tabelle
  from pg_constraint
 where conname like '%erechnung_format_check'
    or conname like '%land_code_check'
    or conname in ('manuelle_empfaenger_zahlungsziel_check', 'rechnungen_zahlungsziel_check',
                   'rechnungspositionen_einheit_code_check', 'rechnungspositionen_steuerkategorie_check');

-- 4) Gleichnamiger Trigger / gleichnamige Funktion
select 'trigger' as art, tgname as name from pg_trigger where tgname = 'rechnung_faelligkeit'
union all
select 'funktion', proname from pg_proc where proname = 'rechnung_faelligkeit_festhalten';

-- 5) Zur Info: Trigger, die heute schon auf rechnungen laufen
select trigger_name, action_timing, event_manipulation
  from information_schema.triggers
 where event_object_schema = 'public' and event_object_table = 'rechnungen'
 order by 1, 3;
