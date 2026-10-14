-- Upload-Hänger durch Kennzeichen mit mehreren Punkten (z.B. „WÜ-IT...E")
-- NUR LESEND — ändert nichts. Im Supabase-SQL-Editor ausführen.
--
-- 1) Welche Formulare haben ein Kennzeichen, das zu einem ungültigen
--    OneDrive-Pfad führte (mehrere Punkte, Punkt/Leerzeichen am Rand,
--    Zeichen wie / : * ? " < > | # %)? Liegt der Stand schon auf dem Server?
--    status = 'draft'      → Entwurf liegt auf dem Server (wurde mind. einmal
--                            „Entwurf speichern"/Zwischenprotokoll gesichert)
--    fotos_hochgeladen     → Fotos mit storage_path (auf OneDrive)
--    fotos_nur_auf_geraet  → Platzhalter (pending_id): Bild liegt NUR auf dem
--                            Gerät des Fahrers in der Upload-Warteschlange
with kandidaten as (
  select af.id, af.status, af.created_at, af.fahrer_id, t.name as template,
         coalesce(af.daten->>'kennzeichen', af.daten->>'Kennzeichen') as kennzeichen,
         af.daten
    from public.ausgefuellte_formulare af
    join public.formular_templates t on t.id = af.template_id
   where af.created_at > now() - interval '60 days'
     and coalesce(af.daten->>'kennzeichen', af.daten->>'Kennzeichen') ~ '(\.\.|^[ .]|[ .]$|[/:*?"<>|#%\\])'
)
select k.id as formular_id, k.status, k.created_at, k.template, k.kennzeichen,
       f.vorname || ' ' || f.nachname as fahrer,
       (select count(*) from jsonb_path_query(k.daten, 'strict $.**.storage_path')) as fotos_hochgeladen,
       (select count(*) from jsonb_path_query(k.daten, 'strict $.**.pending_id'))   as fotos_nur_auf_geraet
  from kandidaten k
  left join public.fahrer f on f.id = k.fahrer_id
 order by k.created_at desc;

-- 2) Was hat das Gerät gemeldet? (Diagnose-Log, Migration 100; ab dieser
--    Version auch Upload-Fehler, Abgleich und „Trotzdem abschließen".)
--    <FORMULAR_ID> aus Abfrage 1 einsetzen.
-- select created_at, ereignis, details, geraet
--   from public.diagnose_log
--  where formular_id = '<FORMULAR_ID>'
--    and (bereich = 'upload' or ereignis like 'foto_%')
--  order by created_at desc
--  limit 100;
