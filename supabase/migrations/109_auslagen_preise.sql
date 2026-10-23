-- Auslagen-Preise je Auftraggeber automatisch einsetzen.
--
-- Anlass: Wartezeit, Ladezeit und Rote Kennzeichen wurden bei den
-- Zusätzen einer Tour per Hand bepreist. Die Preise sind je Auftraggeber
-- verschieden — regelmäßig wurde der falsche Wert eingetragen.
--
-- Eingehängt in die vorhandene Struktur statt parallel:
--   sonderverguetungen (Migration 011) führt pro Auftraggeber bereits
--   Bezeichnung, Preis und Einheit — die Einheit aber nur als Freitext
--   („pro Stunde", „pauschal"). Neu kommen drei maschinenlesbare Spalten
--   dazu, mit denen die Automatik rechnen kann:
--     zusatz_kategorie — zu welcher Zusatz-Kategorie der Preis gehört
--                        (z.B. 'Wartezeit'); leer = keine Automatik
--     abrechnung       — pauschal | stunde | angefangene_stunde |
--                        angefangene_30 | angefangene_15 | tag | stueck
--     freiminuten      — z.B. 30 (erste 30 Min frei)
--   Lesen dürfen sonderverguetungen seit Migration 063 nur Admin (+ Test,
--   read-only). Fahrer und Auftraggeber sehen diese Preise nicht.
--
--   tour_zusaetze (lesbar nur Admin, seit 028) bekommt:
--     dauer_min   — erfasste Dauer bei zeitbasierten Auslagen
--     preis_quelle — 'preisliste' | 'manuell' | NULL (Bestand / ohne Automatik)
--
-- Bestehende Touren, Zusätze, Preise und Rechnungen werden NICHT verändert,
-- es gibt keine nachträgliche Neuberechnung. Vorhandene Sondervergütungen
-- bekommen keine Abrechnungsart „geraten" — die stellt der Admin einmalig
-- in der Preisliste ein (bis dahin keine Automatik).
--
-- Idempotent.

alter table public.sonderverguetungen
  add column if not exists zusatz_kategorie text,
  add column if not exists abrechnung       text,
  add column if not exists freiminuten      int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sonderverguetungen_abrechnung_check') then
    alter table public.sonderverguetungen
      add constraint sonderverguetungen_abrechnung_check
      check (abrechnung is null or abrechnung in
        ('pauschal', 'stunde', 'angefangene_stunde', 'angefangene_30', 'angefangene_15', 'tag', 'stueck'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sonderverguetungen_freiminuten_check') then
    alter table public.sonderverguetungen
      add constraint sonderverguetungen_freiminuten_check check (freiminuten >= 0 and freiminuten <= 24 * 60);
  end if;
end $$;

-- Je Auftraggeber höchstens EIN Preis pro Zusatz-Kategorie — sonst wäre
-- die Automatik mehrdeutig.
create unique index if not exists uq_sonderverguetungen_ag_kategorie
  on public.sonderverguetungen (auftraggeber_id, lower(btrim(zusatz_kategorie)))
  where zusatz_kategorie is not null and btrim(zusatz_kategorie) <> '';

comment on column public.sonderverguetungen.zusatz_kategorie is
  'Zusatz-Kategorie (z.B. Wartezeit), für die dieser Preis automatisch eingesetzt wird. Leer = keine Automatik.';
comment on column public.sonderverguetungen.abrechnung is
  'pauschal | stunde | angefangene_stunde | angefangene_30 | angefangene_15 | tag | stueck — Preis gilt je Einheit.';

alter table public.tour_zusaetze
  add column if not exists dauer_min    int,
  add column if not exists preis_quelle text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tour_zusaetze_preis_quelle_check') then
    alter table public.tour_zusaetze
      add constraint tour_zusaetze_preis_quelle_check
      check (preis_quelle is null or preis_quelle in ('preisliste', 'manuell'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tour_zusaetze_dauer_check') then
    alter table public.tour_zusaetze
      add constraint tour_zusaetze_dauer_check check (dauer_min is null or dauer_min >= 0);
  end if;
end $$;

comment on column public.tour_zusaetze.preis_quelle is
  'preisliste = automatisch aus sonderverguetungen; manuell = vom Admin überschrieben; NULL = Bestand/ohne Automatik.';

notify pgrst, 'reload schema';
