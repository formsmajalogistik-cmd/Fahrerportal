-- ============================================================
-- Maja-Logistik Business-Portal — 059: Test-Rolle (Read-Only)
-- ------------------------------------------------------------
-- Test-Profile dienen internen Demos/UX-Tests. Sie sehen ALLES,
-- dürfen aber NICHTS schreiben.
--
-- Implementierung:
--   * SELECT: pro Tabelle eine zusätzliche Policy
--     `<name>_test_read` mit using (is_test()). Bestehende Policies
--     bleiben unverändert — PostgreSQL kombiniert SELECT-Policies
--     mit OR, der Test-User sieht damit auf jeder Tabelle wie Admin.
--   * INSERT / UPDATE / DELETE: KEINE Policy → RLS blockiert alles.
--     Das Frontend fängt zusätzlich mit einem Guard ab, aber die
--     DB ist die harte Garantie.
--
-- Abgedeckte Tabellen = alle aktuell existierenden Tabellen laut
-- Migrations-Historie (001–056). NICHT enthalten:
--   * formular_zuweisungen — wurde in Migration 023 gedroppt
--     (Template-Sichtbarkeit läuft seitdem über das sichtbar-Flag
--     bzw. tour_protokoll_zuweisungen aus 054).
--   * auftraggeber, auftraggeber_kontakte, preisstufen,
--     sonderverguetungen — deren Read-Policies erlauben
--     "authenticated AND not is_auftraggeber()" und decken die
--     Test-Rolle damit bereits ab.
--
-- Idempotent (drop policy if exists / create or replace function).
-- Voraussetzungen: Migration 058 (Enum-Wert 'test') und 056
-- (template_auftraggeber_freigaben, formular_wuensche) sind gelaufen.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper-Funktion
-- ------------------------------------------------------------

create or replace function public.is_test()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'test'
  );
$$;

grant execute on function public.is_test() to authenticated;

-- ------------------------------------------------------------
-- 2. SELECT-Policies pro Tabelle.
-- ------------------------------------------------------------

drop policy if exists touren_test_read on public.touren;
create policy touren_test_read on public.touren
  for select using (public.is_test());

drop policy if exists tour_zusaetze_test_read on public.tour_zusaetze;
create policy tour_zusaetze_test_read on public.tour_zusaetze
  for select using (public.is_test());

drop policy if exists fahrer_test_read on public.fahrer;
create policy fahrer_test_read on public.fahrer
  for select using (public.is_test());

drop policy if exists af_test_read on public.ausgefuellte_formulare;
create policy af_test_read on public.ausgefuellte_formulare
  for select using (public.is_test());

drop policy if exists templates_test_read on public.formular_templates;
create policy templates_test_read on public.formular_templates
  for select using (public.is_test());

drop policy if exists tpz_test_read on public.tour_protokoll_zuweisungen;
create policy tpz_test_read on public.tour_protokoll_zuweisungen
  for select using (public.is_test());

drop policy if exists taf_test_read on public.template_auftraggeber_freigaben;
create policy taf_test_read on public.template_auftraggeber_freigaben
  for select using (public.is_test());

drop policy if exists fw_test_read on public.formular_wuensche;
create policy fw_test_read on public.formular_wuensche
  for select using (public.is_test());

drop policy if exists greimel_test_read on public.greimel_zugaenge;
create policy greimel_test_read on public.greimel_zugaenge
  for select using (public.is_test());

drop policy if exists rechnungen_test_read on public.rechnungen;
create policy rechnungen_test_read on public.rechnungen
  for select using (public.is_test());

drop policy if exists rechnungspositionen_test_read on public.rechnungspositionen;
create policy rechnungspositionen_test_read on public.rechnungspositionen
  for select using (public.is_test());

drop policy if exists rechnungsadressen_test_read on public.rechnungsadressen;
create policy rechnungsadressen_test_read on public.rechnungsadressen
  for select using (public.is_test());

drop policy if exists email_favoriten_test_read on public.email_favoriten;
create policy email_favoriten_test_read on public.email_favoriten
  for select using (public.is_test());

drop policy if exists routen_cache_test_read on public.routen_cache;
create policy routen_cache_test_read on public.routen_cache
  for select using (public.is_test());

drop policy if exists app_settings_test_read on public.app_settings;
create policy app_settings_test_read on public.app_settings
  for select using (public.is_test());

-- app_users: Test-User soll Konten-Listen einsehen können
-- (z.B. für Anzeige-Simulationen im Frontend).
drop policy if exists app_users_test_read on public.app_users;
create policy app_users_test_read on public.app_users
  for select using (public.is_test());

notify pgrst, 'reload schema';
