-- E-Rechnung, Phase 1a: Datenstruktur vorbereiten (rein additiv).
--
-- Es wird NICHTS versendet und am heutigen PDF ändert sich nichts.
-- Neue Spalten sind bei Bestandszeilen leer (NULL) — es gibt keine
-- rückwirkende Befüllung. Einzige Ausnahme: erechnung_format bekommt
-- 'pdf' (= heutiges Verhalten), damit die Spalte nie leer ist.
--
--   * rechnungen.faellig_am — wird beim Übergang Entwurf → erstellt
--     EINMALIG berechnet (Rechnungsdatum + Zahlungsziel, wie bisher im
--     Browser) und danach nicht mehr verändert. Bestehende Rechnungen
--     bleiben leer; das PDF rechnet dort wie bisher.
--   * rechnungen.zahlungsziel_tage — bei manuellen Rechnungen die
--     Eingabe; bei Auftraggeber-Rechnungen beim Erstellen aus dem
--     Auftraggeber übernommen (Snapshot für die E-Rechnung).
--   * Empfänger: plz/ort getrennt, land_code (ISO 3166-1 alpha-2),
--     erechnung_format, erechnung_email, kaeufer_referenz — an
--     auftraggeber, rechnungsadressen (nur Adressteile) und
--     manuelle_empfaenger; dazu der Snapshot an der Rechnung.
--     Das bisherige plz_ort bleibt und wird vom PDF weiter verwendet.
--   * rechnungspositionen: einheit_code (UN/ECE Rec. 20), steuerkategorie
--     (BT-151), befreiungsgrund_code/_text — alles nullable, ohne Default.
--
-- Idempotent.

-- ------------------------------------------------------------
-- 1. Rechnungen
-- ------------------------------------------------------------
alter table public.rechnungen
  add column if not exists faellig_am                 date,
  add column if not exists zahlungsziel_tage          integer,
  add column if not exists rechnungsadresse_plz       text,
  add column if not exists rechnungsadresse_ort       text,
  add column if not exists rechnungsadresse_land_code text,
  add column if not exists erechnung_format           text,
  add column if not exists erechnung_email            text,
  add column if not exists kaeufer_referenz           text;

comment on column public.rechnungen.faellig_am is
  'Fälligkeitsdatum, einmalig beim Übergang Entwurf → erstellt berechnet (Rechnungsdatum + Zahlungsziel). NULL bei Rechnungen von vor Migration 115.';
comment on column public.rechnungen.zahlungsziel_tage is
  'Zahlungsziel der Rechnung (Snapshot). Manuelle Rechnungen: Eingabe; Auftraggeber-Rechnungen: beim Erstellen aus dem Auftraggeber.';
comment on column public.rechnungen.rechnungsadresse_land_code is
  'ISO 3166-1 alpha-2 des Empfängers (Snapshot). Das PDF nutzt weiterhin rechnungsadresse_land/plz_ort.';
comment on column public.rechnungen.erechnung_format is
  'Snapshot der Format-Einstellung des Empfängers beim Anlegen: pdf | xrechnung_cii | zugferd.';

-- ------------------------------------------------------------
-- 2. Empfänger-Stammdaten
-- ------------------------------------------------------------
alter table public.auftraggeber
  add column if not exists land_code        text,
  add column if not exists erechnung_format text not null default 'pdf',
  add column if not exists erechnung_email  text,
  add column if not exists kaeufer_referenz text;

alter table public.rechnungsadressen
  add column if not exists plz       text,
  add column if not exists ort       text,
  add column if not exists land_code text;

alter table public.manuelle_empfaenger
  add column if not exists land_code         text,
  add column if not exists zahlungsziel_tage integer,
  add column if not exists erechnung_format  text not null default 'pdf',
  add column if not exists erechnung_email   text,
  add column if not exists kaeufer_referenz  text;

-- Default 'DE' NUR für neue Zeilen: erst nach dem ADD COLUMN gesetzt,
-- damit Bestandszeilen NULL bleiben (Vorschlag kommt aus dem Probelauf).
alter table public.auftraggeber        alter column land_code set default 'DE';
alter table public.rechnungsadressen   alter column land_code set default 'DE';
alter table public.manuelle_empfaenger alter column land_code set default 'DE';

comment on column public.auftraggeber.erechnung_format is
  'Rechnungsformat: pdf (wie bisher) | xrechnung_cii | zugferd. Vorerst nur pdf wählbar.';
comment on column public.auftraggeber.kaeufer_referenz is
  'Buyer Reference / Leitweg-ID (EN 16931 BT-10).';
comment on column public.rechnungsadressen.plz is
  'PLZ getrennt (für die E-Rechnung). Das PDF nutzt weiterhin plz_ort.';

-- ------------------------------------------------------------
-- 3. Positionen
-- ------------------------------------------------------------
alter table public.rechnungspositionen
  add column if not exists einheit_code         text,
  add column if not exists steuerkategorie      text,
  add column if not exists befreiungsgrund_code text,
  add column if not exists befreiungsgrund_text text;

comment on column public.rechnungspositionen.einheit_code is
  'Mengeneinheit UN/ECE Rec. 20 (z.B. C62). NULL = Generator nimmt vorerst C62.';
comment on column public.rechnungspositionen.steuerkategorie is
  'USt-Kategorie EN 16931 BT-151 (UNCL 5305). NULL = vorerst aus dem Satz abgeleitet (> 0 → S).';

-- ------------------------------------------------------------
-- 4. Prüfregeln (nur für neue Werte relevant; Bestand ist NULL)
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('auftraggeber',        'auftraggeber_erechnung_format_check',        'erechnung_format in (''pdf'', ''xrechnung_cii'', ''zugferd'')'),
      ('manuelle_empfaenger', 'manuelle_empfaenger_erechnung_format_check', 'erechnung_format in (''pdf'', ''xrechnung_cii'', ''zugferd'')'),
      ('rechnungen',          'rechnungen_erechnung_format_check',          'erechnung_format is null or erechnung_format in (''pdf'', ''xrechnung_cii'', ''zugferd'')'),
      ('auftraggeber',        'auftraggeber_land_code_check',               'land_code is null or land_code ~ ''^[A-Z]{2}$'''),
      ('rechnungsadressen',   'rechnungsadressen_land_code_check',          'land_code is null or land_code ~ ''^[A-Z]{2}$'''),
      ('manuelle_empfaenger', 'manuelle_empfaenger_land_code_check',        'land_code is null or land_code ~ ''^[A-Z]{2}$'''),
      ('rechnungen',          'rechnungen_land_code_check',                 'rechnungsadresse_land_code is null or rechnungsadresse_land_code ~ ''^[A-Z]{2}$'''),
      ('manuelle_empfaenger', 'manuelle_empfaenger_zahlungsziel_check',     'zahlungsziel_tage is null or zahlungsziel_tage between 0 and 365'),
      ('rechnungen',          'rechnungen_zahlungsziel_check',              'zahlungsziel_tage is null or zahlungsziel_tage between 0 and 365'),
      ('rechnungspositionen', 'rechnungspositionen_einheit_code_check',     'einheit_code is null or einheit_code ~ ''^[A-Z0-9]{1,3}$'''),
      ('rechnungspositionen', 'rechnungspositionen_steuerkategorie_check',  'steuerkategorie is null or steuerkategorie in (''S'', ''Z'', ''E'', ''AE'', ''K'', ''G'', ''O'', ''L'', ''M'')')
    ) as t(tabelle, name, ausdruck)
  loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I check (%s)', r.tabelle, r.name, r.ausdruck);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5. Fälligkeit einmalig beim Erstellen festhalten
--
--    Greift nur, wenn eine Rechnung NEU als erstellt angelegt wird oder
--    vom Entwurf in einen anderen Status wechselt — und nur, solange
--    faellig_am noch leer ist. „Zurück auf offen" (bezahlt → offen)
--    und spätere Änderungen lösen nichts aus.
-- ------------------------------------------------------------
create or replace function public.rechnung_faelligkeit_festhalten()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ziel integer;
begin
  if new.status = 'entwurf' then return new; end if;
  if tg_op = 'UPDATE' and old.status is distinct from 'entwurf' then return new; end if;

  if new.empfaenger_typ is distinct from 'manuell' and new.zahlungsziel_tage is null and new.auftraggeber_id is not null then
    select a.zahlungsziel_tage into v_ziel from auftraggeber a where a.id = new.auftraggeber_id;
    new.zahlungsziel_tage := v_ziel;
  end if;

  if new.faellig_am is null and new.datum is not null and new.zahlungsziel_tage is not null then
    new.faellig_am := new.datum + new.zahlungsziel_tage;
  end if;
  return new;
end;
$$;

drop trigger if exists rechnung_faelligkeit on public.rechnungen;
create trigger rechnung_faelligkeit
  before insert or update of status on public.rechnungen
  for each row execute function public.rechnung_faelligkeit_festhalten();

notify pgrst, 'reload schema';
