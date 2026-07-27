-- ============================================================
-- Maja-Logistik Business-Portal — 073: Tour-ID RLS-unabhängig vergeben
-- ------------------------------------------------------------
-- BUG: Von Auftraggebern eingereichte Touren bekamen T-JJJJ-0001,
-- obwohl der Bestand längst bei z.B. T-2026-4419 steht.
--
-- Ursache: Der Generator-Trigger assign_tour_id() (012) ist eine
-- INVOKER-Funktion. Sein
--     select max(...) from public.touren where tour_id like 'T-JJJJ-%'
-- läuft daher unter der RLS des EINFÜGENDEN Nutzers. Seit dem H-1-Fix
-- (063) haben Auftraggeber KEINE SELECT-Policy auf touren mehr → die
-- Max-Abfrage liefert 0 Zeilen → coalesce(...,0)+1 = 0001.
--
-- Empirisch reproduziert: Bestand 4419/4420/4421, AG-Einreichung
-- bekommt 0001; die ZWEITE AG-Einreichung scheitert dann hart an
-- touren_tour_id_key (unique). Es entstehen also KEINE stillen
-- Duplikate — aber falsche Nummern und ab der zweiten Einreichung ein
-- Fehler für den Auftraggeber.
--
-- Fix: assign_tour_id() auf SECURITY DEFINER umstellen — die Funktion
-- sieht damit immer den echten Gesamtbestand, unabhängig davon, wer
-- einfügt. Logik (Advisory-Lock pro Jahr, Format, Vorrang für explizit
-- gesetzte tour_id) bleibt unverändert.
--
-- Zusätzlich: statt max+1 wird die nächste FREIE Nummer gesucht. Falls
-- während der Bugphase bereits niedrige Nummern vergeben wurden, kann
-- so kein Konflikt mit dem Unique-Index entstehen.
--
-- Der Unique-Constraint auf touren.tour_id existiert bereits seit 012
-- (`tour_id text unique`) und bleibt — er ist die technische Garantie
-- gegen Duplikate.
--
-- Idempotent.
-- ============================================================

create or replace function public.assign_tour_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year       int;
  v_next       int;
  v_lock_key   bigint;
begin
  -- Explizit gesetzte tour_id (z.B. Excel-Import) hat Vorrang.
  if new.tour_id is not null and new.tour_id <> '' then
    return new;
  end if;
  v_year := extract(year from coalesce(new.created_at, now()))::int;
  -- Eindeutiger 64-bit-Lock-Key pro Jahr (Präfix 84600 = "TOUR")
  v_lock_key := 84600000000 + v_year;
  perform pg_advisory_xact_lock(v_lock_key);

  -- SECURITY DEFINER: sieht den GESAMTEN Bestand, nicht nur die per
  -- RLS sichtbaren Zeilen des Aufrufers.
  select coalesce(
    max(
      nullif(regexp_replace(t.tour_id, '^T-' || v_year || '-', ''), '')::int
    ),
    0
  ) + 1
    into v_next
    from public.touren t
   where t.tour_id like 'T-' || v_year || '-%';

  -- Sicherheitsnetz: nächste FREIE Nummer suchen. Greift nur, wenn
  -- durch die frühere Fehlvergabe Lücken/Belegungen existieren.
  while exists (
    select 1 from public.touren t
     where t.tour_id = 'T-' || v_year || '-' || lpad(v_next::text, 4, '0')
  ) loop
    v_next := v_next + 1;
  end loop;

  new.tour_id := 'T-' || v_year || '-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

-- Trigger neu verdrahten (idempotent; Definition unverändert).
drop trigger if exists touren_assign_tour_id on public.touren;
create trigger touren_assign_tour_id
  before insert on public.touren
  for each row execute function public.assign_tour_id();

notify pgrst, 'reload schema';
