-- ============================================================
-- Maja-Logistik Business-Portal — 042: Rechnungs-Status
-- vereinfachen + next-Nummer-RPC.
-- ------------------------------------------------------------
-- Status-Flow neu: entwurf → offen → bezahlt (+ storniert).
-- "versendet" entfällt komplett; "erstellt" wurde umbenannt zu
-- "offen". Bestandsdaten mit beiden alten Werten werden auf "offen"
-- migriert.
--
-- Außerdem: RPC next_rechnungsnummer(p_year) liefert die nächste
-- freie Nummer für ein Jahr. Der Frontend-Dialog kann sie damit
-- VOR dem Submit vorzeigen und beim Speichern direkt mitsenden —
-- der Admin kann die Nummer aber jederzeit überschreiben.
-- ============================================================

-- 1) Bestandsdaten migrieren (vor CHECK-Drop, damit kein Constraint
--    verletzt wird).
update public.rechnungen
   set status = 'offen'
 where status in ('erstellt', 'versendet');

-- 2) CHECK-Constraint austauschen.
alter table public.rechnungen
  drop constraint if exists rechnungen_status_check;
alter table public.rechnungen
  add constraint rechnungen_status_check
    check (status in ('entwurf', 'offen', 'bezahlt', 'storniert'));

-- 3) Default-Status bleibt 'entwurf' — keine Änderung nötig.

-- 4) Sicherstellen, dass bezahlt_am bei nicht-bezahlten Status NULL
--    ist (Datenhygiene; kein NOT-NULL-Constraint, weil "offen" oder
--    "entwurf" bei Bestandsdaten ggf. einen Altwert haben könnten).
update public.rechnungen
   set bezahlt_am = null
 where status <> 'bezahlt'
   and bezahlt_am is not null;

-- 5) RPC: nächste freie Rechnungsnummer fürs Jahr ermitteln.
--    Selber Algorithmus wie der Trigger — nimmt das Maximum aller
--    bisherigen Re-{Jahr}/N und +1, mit Advisory-Lock, damit zwei
--    parallele Vorschauen nicht dieselbe Nummer melden.
create or replace function public.next_rechnungsnummer(p_year integer default extract(year from current_date)::int)
returns text
language plpgsql
as $$
declare
  v_next     int;
  v_lock_key bigint;
begin
  v_lock_key := 73436000000 + p_year;
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(
    max(
      nullif(regexp_replace(r.rechnungsnummer, '^Re-' || p_year || '/', ''), '')::int
    ),
    0
  ) + 1
    into v_next
    from public.rechnungen r
   where r.rechnungsnummer like 'Re-' || p_year || '/%';

  return 'Re-' || p_year || '/' || v_next::text;
end;
$$;

revoke all on function public.next_rechnungsnummer(integer) from public;
grant execute on function public.next_rechnungsnummer(integer) to authenticated;

notify pgrst, 'reload schema';
