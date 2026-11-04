-- Übernahme „Keine Auslagen" (Migration 112 → 113) — PROBELAUF, nur lesen.
--
-- Im Supabase-SQL-Editor ausführen, NACH Migration 113. Zeigt je Tour mit
-- alter Markierung (tour_keine_auslagen) die Kennzeichen, die einen Zusatz
-- „Keine Auslagen" bekämen: nur Kennzeichen ohne echte Auslage und ohne
-- vorhandenes „Keine Auslagen". Ändert nichts.

-- 1) Anzahl
select count(*) as anzulegende_eintraege, count(distinct tour_id) as touren
  from public.keine_auslagen_uebernahme_kandidaten();

-- 2) Liste
select tour_nr, tourenart,
       case rolle when 'hin' then 'Hin' when 'rueck' then 'Rück' else '—' end as kennzeichen_rolle,
       coalesce(kennzeichen, '(kein Kennzeichen erfasst)') as kennzeichen
  from public.keine_auslagen_uebernahme_kandidaten();

-- 3) Markierte Touren, die NICHTS bekommen (alle Kennzeichen schon geklärt)
select t.tour_id as tour_nr
  from public.tour_keine_auslagen m join public.touren t on t.id = m.tour_id
 where not exists (select 1 from public.keine_auslagen_uebernahme_kandidaten() k where k.tour_id = m.tour_id)
 order by 1;
