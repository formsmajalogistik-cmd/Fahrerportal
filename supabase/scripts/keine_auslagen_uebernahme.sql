-- Übernahme „Keine Auslagen" (Migration 112 → 113) — SCHREIBT.
--
-- Erst nach Bestätigung des Probelaufs (keine_auslagen_uebernahme_probelauf.sql)
-- ausführen. Legt je Kandidat (Kennzeichen ohne echte Auslage und ohne
-- „Keine Auslagen") einen Zusatz „Keine Auslagen" an (anzahl 1, betrag 0).
-- Idempotent: ein zweiter Lauf findet keine Kandidaten mehr und legt
-- nichts doppelt an. Die alte Markierung bleibt unverändert stehen.
-- Jeder Eintrag landet über den Trigger im Änderungsprotokoll der Tour.

begin;

insert into public.tour_zusaetze (tour_id, kategorie, anzahl, betrag, kennzeichen, notiz)
select k.tour_id, 'Keine Auslagen', 1, 0, k.kennzeichen,
       'Übernommen aus der Markierung „Keine Auslagen" an der Tour'
  from public.keine_auslagen_uebernahme_kandidaten() k;

-- Kontrolle: sollte 0 liefern
select count(*) as noch_offen from public.keine_auslagen_uebernahme_kandidaten();

commit;
