-- ============================================================
-- SCHRITT 3 — PLZ-Extraktion: TROCKENLAUF (ändert NICHTS)
-- ------------------------------------------------------------
-- Zeigt nur "vorher → nachher". Erst nach ausdrücklicher Freigabe
-- gibt es dazu ein Update-Skript.
--
-- Bewusst enge Regel — es wird NUR der kanonische Fall angefasst:
--
--     "<Straße Nr>, <5-stellige PLZ> <Ort>"
--
-- also genau ein Komma-Teil am Ende, der mit einer 5-stelligen
-- Zahl beginnt. Alles andere (kein Komma, mehrere 5-stellige
-- Zahlen, Zusätze wie "Hinterhof", Auslandsformate) bleibt
-- unverändert im Straßenfeld stehen.
--
-- Wichtig: würde man nur die PLZ herausziehen und die Straße
-- unverändert lassen, stünde die PLZ doppelt in der
-- zusammengesetzten Adresse. Deshalb schneidet der Vorschlag den
-- Ortsteil aus dem Straßenfeld heraus — und genau deshalb ist die
-- Regel so eng gefasst.
-- ============================================================

with kandidaten as (
  select
    id,
    start_stadt,
    strasse_start as vorher,
    -- Teil nach dem LETZTEN Komma
    btrim(substring(strasse_start from '[^,]+$'))              as ortsteil,
    btrim(substring(strasse_start from '^(.*),[^,]+$'))        as strasse_ohne_ort
    from public.touren
   where coalesce(btrim(strasse_start), '') <> ''
     and coalesce(btrim(plz_start), '') = ''
     and strasse_start like '%,%'
)
select
  start_stadt,
  vorher,
  strasse_ohne_ort                                    as nachher_strasse,
  substring(ortsteil from '^([0-9]{5})')              as nachher_plz,
  btrim(substring(ortsteil from '^[0-9]{5}\s+(.*)$')) as ort_im_wert,
  case
    when ortsteil ~ '^[0-9]{5}(\s+\S.*)?$' then 'wird geändert'
    else 'bleibt unverändert (Muster passt nicht)'
  end                                                 as entscheidung
  from kandidaten
 order by entscheidung, start_stadt
 limit 20;

-- Zusammenfassung: wie viele Zeilen würde die Regel treffen?
with kandidaten as (
  select btrim(substring(strasse_start from '[^,]+$')) as ortsteil
    from public.touren
   where coalesce(btrim(strasse_start), '') <> ''
     and coalesce(btrim(plz_start), '') = ''
     and strasse_start like '%,%'
)
select
  count(*)                                                      as kandidaten_gesamt,
  count(*) filter (where ortsteil ~ '^[0-9]{5}(\s+\S.*)?$')     as wuerden_geaendert
  from kandidaten;
