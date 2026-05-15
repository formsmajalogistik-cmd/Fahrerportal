-- ============================================================
-- Maja-Logistik Business-Portal — 029: Greimel-Zugänge automatisch
-- freigeben, sobald eine Tour abgeschlossen ist.
-- ------------------------------------------------------------
-- Bisher musste der Admin im Detail-Panel speichern, damit der
-- Zugang vom Fahrer entkoppelt wird. Tritt der Statuswechsel
-- aber rein durch Zeitablauf ein (Enddatum < heute), blieb die
-- Verknüpfung — der Zugang erschien weiter als belegt.
--
-- Die folgende SECURITY-DEFINER-Funktion erledigt das in einem
-- Rutsch: für jede Tour mit enddatum < CURRENT_DATE und gesetztem
-- greimel_zugang_id wird der Fahrer aus dem fahrer_ids-Array
-- entfernt (nur wenn er keine ANDERE aktive/geplante Tour mit
-- demselben Zugang hat) und greimel_zugang_id auf NULL gesetzt.
--
-- Aufruf: aus dem Frontend nach Laden der Tourenliste — und
-- zusätzlich aus einem Vercel-Cron einmal pro Nacht.
-- ============================================================

create or replace function public.release_completed_greimel_zugaenge()
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
    select t.id, t.greimel_zugang_id, t.fahrer_id
    from public.touren t
    where t.greimel_zugang_id is not null
      and t.enddatum < current_date
  loop
    -- Fahrer nur aus dem Zugang nehmen, wenn keine weitere aktive
    -- oder geplante Tour denselben Zugang nutzt.
    if r.fahrer_id is not null then
      if not exists (
        select 1 from public.touren tt
        where tt.greimel_zugang_id = r.greimel_zugang_id
          and tt.fahrer_id = r.fahrer_id
          and tt.id <> r.id
          and tt.enddatum >= current_date
      ) then
        update public.greimel_zugaenge
           set fahrer_ids = array_remove(fahrer_ids, r.fahrer_id)
         where id = r.greimel_zugang_id;
      end if;
    end if;

    update public.touren
       set greimel_zugang_id = null
     where id = r.id;

    freigegeben := freigegeben + 1;
  end loop;
  return freigegeben;
end;
$$;

grant execute on function public.release_completed_greimel_zugaenge() to authenticated;
