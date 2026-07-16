-- ============================================================
-- Maja-Logistik Business-Portal — 069: Verwaiste Greimel-Zuweisungen
-- ------------------------------------------------------------
-- Symptom: Ein Zugang ist einem Fahrer zugewiesen (fahrer_ids), obwohl
-- KEINE verknüpfte Tour (mehr) existiert — z.B. weil die Tour gelöscht
-- oder umgehängt wurde, bevor die Client-seitige Synchronisierung
-- greifen konnte. Der Zugang bleibt dadurch blockiert.
--
-- Neue RPC release_orphaned_greimel_zugaenge(): entfernt Fahrer aus
-- fahrer_ids, wenn KEINE nicht-abgeschlossene Tour (enddatum >= heute)
-- diesen Zugang mit diesem Fahrer nutzt.
--
-- BEWUSST als SEPARATE Funktion (nicht in
-- release_completed_greimel_zugaenge integriert): letztere wird bei
-- jedem Admin-Tourenlisten-Load aufgerufen. Die Waisen-Bereinigung
-- läuft NUR im nächtlichen Cron — so überlebt eine manuelle Zuweisung
-- (Zugang erst zuweisen, Tour später anlegen) zumindest den Arbeitstag.
-- sichtbar_fuer_alle-Zugänge sind nicht betroffen (fahrer_ids leer).
--
-- Idempotent.
-- ============================================================

create or replace function public.release_orphaned_greimel_zugaenge()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  freigegeben integer := 0;
begin
  for r in
    select z.id as zugang_id, f.fid
    from public.greimel_zugaenge z
    cross join lateral unnest(z.fahrer_ids) as f(fid)
    where not exists (
      select 1 from public.touren t
      where t.greimel_zugang_id = z.id
        and t.fahrer_id = f.fid
        and t.enddatum >= current_date
    )
  loop
    update public.greimel_zugaenge
       set fahrer_ids = array_remove(fahrer_ids, r.fid)
     where id = r.zugang_id;
    freigegeben := freigegeben + 1;
  end loop;
  return freigegeben;
end;
$$;

revoke all on function public.release_orphaned_greimel_zugaenge() from public;
grant execute on function public.release_orphaned_greimel_zugaenge() to authenticated;
grant execute on function public.release_orphaned_greimel_zugaenge() to service_role;

notify pgrst, 'reload schema';
