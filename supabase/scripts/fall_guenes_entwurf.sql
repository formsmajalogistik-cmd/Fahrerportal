-- Fall Emre Günes (Formular begonnen 15.10.2026, am 19.10. leer)
-- NUR LESEND — ändert nichts. Im Supabase-SQL-Editor ausführen.

-- 1) Formulare des Fahrers ab dem 15.10.: was steht serverseitig drin?
--    felder_ausgefuellt zählt Felder mit Wert (ohne interne _-Schlüssel).
--    Bis Migration 107 gibt es KEIN updated_at — wann zuletzt geschrieben
--    wurde, ist serverseitig nicht feststellbar. Geschrieben wurde `daten`
--    vor 107 nur bei: Anlegen (Vorbelegung aus der Tour), „Entwurf
--    speichern", Zwischenprotokoll, Abschließen, Recovery-Seite.
select af.id, af.status, af.created_at, t.name as template,
       af.zwischenprotokoll_erstellt_am, af.pdf_status,
       (select count(*) from jsonb_each(af.daten) e
         where e.key not like '\_%'
           and e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb, 'false'::jsonb)) as felder_ausgefuellt,
       (select string_agg(e.key, ', ' order by e.key) from jsonb_each(af.daten) e) as schluessel,
       (select count(*) from jsonb_path_query(af.daten, 'strict $.**.storage_path')) as fotos_referenziert,
       af.daten ->> '_tour_id' as tour
  from public.ausgefuellte_formulare af
  join public.fahrer f on f.id = af.fahrer_id
  left join public.app_users u on u.id = f.user_id
  join public.formular_templates t on t.id = af.template_id
 where af.created_at >= '2026-10-15'
   and (coalesce(f.vorname, u.vorname, '') || ' ' || coalesce(f.nachname, u.nachname, '')) ilike '%g_nes%'
 order by af.created_at;

-- 2) Diagnose-Log dieses Formulars (FORMULAR_ID aus 1 einsetzen): alle
--    Ereignisse inkl. Gerät — zeigt, ob Browser oder installierte App.
-- select created_at, bereich, ereignis, details, geraet
--   from public.diagnose_log
--  where formular_id = '<FORMULAR_ID>'
--  order by created_at;

-- 3) Versions-Snapshots: Die Tabelle formular_entwurf_versionen existierte
--    vor Migration 107 nicht (der Mechanismus war nie umgesetzt). Ab 107:
-- select erstellt_am, vorgang, app_modus, felder_anzahl
--   from public.formular_entwurf_versionen
--  where formular_id = '<FORMULAR_ID>' order by erstellt_am desc;
