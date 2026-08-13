-- ============================================================
-- SCHRITT 2 — Alt-Adressen in das Straßenfeld übernehmen
-- ------------------------------------------------------------
-- BEWUSST KEINE Migration: liegt unter scripts/ und läuft NICHT
-- automatisch mit. Erst nach Freigabe und nach Schritt 1 manuell
-- ausführen.
--
-- Grundregel: der komplette Alt-Wert wandert UNVERÄNDERT in das
-- Straßenfeld. Kein Zerlegen in Straße/PLZ/Ort — ein falsch
-- aufgeteilter Wert wäre schlimmer als ein voller Straßeneintrag.
--
-- Sicherheitsregeln:
--   * nur dort, wo das neue Feld leer ist (btrim, fängt auch
--     Leerzeichen-Werte ab) — bereits erfasste Werte bleiben
--   * die alten Spalten bleiben unangetastet → jederzeit
--     nachvollziehbar und rückgängig zu machen
--   * idempotent: ein zweiter Lauf trifft 0 Zeilen
--   * läuft in EINER Transaktion mit Vorher-/Nachher-Zählung
-- ============================================================

begin;

-- Vorher zählen.
create temporary table _adressen_vorher on commit drop as
select
  count(*) filter (where coalesce(btrim(adresse_start), '') <> ''
                     and coalesce(btrim(strasse_start), '') = '')   as start_offen,
  count(*) filter (where coalesce(btrim(adresse_ziel), '') <> ''
                     and coalesce(btrim(strasse_ziel), '') = '')    as ziel_offen,
  count(*) filter (where coalesce(btrim(adresse_rueckfuehrung), '') <> ''
                     and coalesce(btrim(strasse_rueckfuehrung), '') = '')
                                                                    as rueck_offen
  from public.touren;

update public.touren
   set strasse_start = btrim(adresse_start)
 where coalesce(btrim(adresse_start), '') <> ''
   and coalesce(btrim(strasse_start), '') = '';

update public.touren
   set strasse_ziel = btrim(adresse_ziel)
 where coalesce(btrim(adresse_ziel), '') <> ''
   and coalesce(btrim(strasse_ziel), '') = '';

update public.touren
   set strasse_rueckfuehrung = btrim(adresse_rueckfuehrung)
 where coalesce(btrim(adresse_rueckfuehrung), '') <> ''
   and coalesce(btrim(strasse_rueckfuehrung), '') = '';

-- Ergebnis: übernommen = vorher offen minus jetzt noch offen.
select
  v.start_offen                                                     as start_uebernommen,
  v.ziel_offen                                                      as ziel_uebernommen,
  v.rueck_offen                                                     as rueck_uebernommen,
  (select count(*) from public.touren
    where coalesce(btrim(adresse_start), '') <> ''
      and coalesce(btrim(strasse_start), '') = '')                  as start_noch_offen,
  (select count(*) from public.touren
    where coalesce(btrim(adresse_ziel), '') <> ''
      and coalesce(btrim(strasse_ziel), '') = '')                   as ziel_noch_offen,
  (select count(*) from public.touren
    where coalesce(btrim(adresse_rueckfuehrung), '') <> ''
      and coalesce(btrim(strasse_rueckfuehrung), '') = '')          as rueck_noch_offen
  from _adressen_vorher v;

commit;
