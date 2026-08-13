-- ============================================================
-- SCHRITT 1 — Bestandsaufnahme Alt-Adressen (NUR LESEN)
-- ------------------------------------------------------------
-- Ändert NICHTS. Vor der Übernahme ausführen und das Ergebnis
-- prüfen. Alle Spaltennamen sind gegen das Schema verifiziert
-- (013 = adresse_*, 086 = strasse_*/plz_*).
-- ============================================================

-- 1a) Existieren die Spalten überhaupt (und sind sie nullable)?
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'touren'
   and (column_name like 'adresse\_%'
     or column_name like 'strasse\_%'
     or column_name like 'plz\_%')
 order by column_name;

-- 1b) Wie viele Touren sind betroffen?
--     "betroffen" = Alt-Wert vorhanden UND neues Straßenfeld leer.
select
  count(*)                                                          as touren_gesamt,
  count(*) filter (where coalesce(btrim(adresse_start), '') <> ''
                     and coalesce(btrim(strasse_start), '') = '')   as start_betroffen,
  count(*) filter (where coalesce(btrim(adresse_ziel), '') <> ''
                     and coalesce(btrim(strasse_ziel), '') = '')    as ziel_betroffen,
  count(*) filter (where coalesce(btrim(adresse_rueckfuehrung), '') <> ''
                     and coalesce(btrim(strasse_rueckfuehrung), '') = '')
                                                                    as rueck_betroffen,
  -- Gegenprobe: schon auf die neuen Felder umgestellt
  count(*) filter (where coalesce(btrim(strasse_start), '') <> '')  as start_bereits_neu
  from public.touren;

-- 1c) 10 Beispielwerte — zeigt, wie die Alt-Adressen aufgebaut sind.
--     `enthaelt_plz` markiert eine allein stehende 5-stellige Zahl
--     (Kandidat für die optionale PLZ-Extraktion in Schritt 3).
select
  adresse_start   as alt_wert,
  start_stadt     as stadt_der_tour,
  (adresse_start ~ '(^|[^0-9])[0-9]{5}([^0-9]|$)') as enthaelt_plz,
  (adresse_start like '%,%')                       as enthaelt_komma
  from public.touren
 where coalesce(btrim(adresse_start), '') <> ''
   and coalesce(btrim(strasse_start), '') = ''
 limit 10;

-- 1d) Wie oft käme eine PLZ-Extraktion überhaupt in Frage?
--     Nur zur Entscheidungshilfe für Schritt 3 — ändert nichts.
select
  count(*)                                                                  as betroffen_start,
  count(*) filter (where adresse_start ~ '(^|[^0-9])[0-9]{5}([^0-9]|$)')    as davon_mit_plz
  from public.touren
 where coalesce(btrim(adresse_start), '') <> ''
   and coalesce(btrim(strasse_start), '') = '';
