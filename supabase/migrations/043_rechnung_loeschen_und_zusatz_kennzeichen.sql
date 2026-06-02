-- ============================================================
-- Maja-Logistik Business-Portal — 043: Status 'storniert' raus,
-- Zusätze pro Kennzeichen.
-- ------------------------------------------------------------
-- Rechnungen können jetzt komplett gelöscht werden (Buchhaltungs-
-- Anforderung). Damit entfällt der "Stornieren"-Workflow — die
-- Status-Enum wird auf entwurf / offen / bezahlt reduziert.
--
-- tour_zusaetze.kennzeichen erlaubt bei ABA-/ABC-Touren das
-- Zuordnen eines Zusatzes zu Hin- bzw. Rück-Kennzeichen; NULL =
-- gilt für die Gesamttour (Default, abwärtskompatibel).
-- ============================================================

-- 1) Bestandsdaten: stornierte Rechnungen mitsamt ihrer Positionen
--    (CASCADE) endgültig entfernen.
delete from public.rechnungen
 where status = 'storniert';

-- 2) CHECK-Constraint austauschen.
alter table public.rechnungen
  drop constraint if exists rechnungen_status_check;
alter table public.rechnungen
  add constraint rechnungen_status_check
    check (status in ('entwurf', 'offen', 'bezahlt'));

-- 3) tour_zusaetze.kennzeichen — Default NULL.
alter table public.tour_zusaetze
  add column if not exists kennzeichen text;

notify pgrst, 'reload schema';
