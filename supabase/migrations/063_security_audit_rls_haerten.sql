-- ============================================================
-- Maja-Logistik Business-Portal — 063: Sicherheits-Audit-Härtung
-- ------------------------------------------------------------
-- Behebt drei RLS-Befunde aus dem Sicherheits-Audit (2026-06):
--
-- H-1 (HOCH): Auftraggeber konnten Preis-/Fahrer-Spalten direkt lesen.
--   Die Policy touren_auftraggeber_read (056/057) gab Auftraggeber-
--   Profilen ZEILEN-Zugriff auf public.touren. RLS ist row-, nicht
--   column-level — ein direkter from('touren').select('*') lieferte
--   damit ALLE Spalten, inkl. verguetung, fahrer_id, fahrer_honorar,
--   barauslagen. Der Spaltenschutz lebte bisher nur in der View
--   touren_kundensicht.
--
--   Column-Grants helfen hier NICHT: in Supabase teilen sich alle
--   eingeloggten Nutzer die Postgres-Rolle `authenticated`; ein
--   REVOKE auf einzelne Spalten träfe auch Admin und Fahrer. Die
--   Rollen-Unterscheidung passiert ausschließlich über RLS + JWT.
--
--   Lösung:
--     * Auftraggeber-Lesezugriff läuft AUSSCHLIESSLICH über die
--       SECURITY-DEFINER-Funktion touren_kundensicht_rows(). Sie gibt
--       nur die unkritischen Spalten zurück (keine verguetung-/
--       fahrer-Felder) und beschränkt die Zeilen auf den eigenen
--       Auftraggeber. Ein Direkt-Aufruf der Funktion kann daher
--       ebenfalls nichts Sensibles liefern.
--     * Die View touren_kundensicht (security_invoker = true, aus 057)
--       selektiert nur noch aus dieser Funktion — Frontend und der
--       057-Advisor-Fix (kein SECURITY-DEFINER-View) bleiben erhalten.
--     * Die breite SELECT-Policy touren_auftraggeber_read wird
--       ENTFERNT. Danach liefert ein Direkt-Query auf touren einem
--       Auftraggeber KEINE Zeile mehr.
--     * Policies, die touren in einem Subquery referenzierten und
--       bisher implizit auf touren_auftraggeber_read aufbauten
--       (af_auftraggeber_read, tpz_auftraggeber_read), werden auf
--       SECURITY-DEFINER-Helper umgestellt. Grund: PostgreSQL wendet
--       RLS auch auf Tabellen an, die innerhalb eines Policy-Ausdrucks
--       referenziert werden — ohne diese Umstellung sähen Auftraggeber
--       ihre Formulare und Protokoll-Zuweisungen nach dem Drop nicht
--       mehr.
--
-- M-1 (MITTEL): rechnungsadressen_read (034) erlaubte ALLEN
--   Authentifizierten Lesen (auch Fahrer + Auftraggeber). Genutzt
--   wird die Tabelle nur in Admin-Views. Neu: nur Admin. Die Test-
--   Rolle liest weiter über rechnungsadressen_test_read (059).
--
-- M-2 (MITTEL): preisstufen/sonderverguetungen waren für alle
--   Authentifizierten AUSSER Auftraggeber lesbar — also auch für
--   Fahrer. Keine Fahrer-Ansicht lädt diese Daten (Preis-Breakdown
--   ist admin-gated; Fahrer-Queries lassen km_gesamt weg, wodurch der
--   Preis-Lookup gar nicht erst feuert). Neu: nur Admin (+ Test, um
--   die 059-Invariante "Test sieht alles, schreibt nichts" zu
--   erhalten — für diese beiden Tabellen gibt es bewusst keine eigene
--   *_test_read-Policy, siehe 059-Kommentar).
--   auftraggeber / auftraggeber_kontakte bleiben für Fahrer lesbar
--   (Stammdaten/Adressen werden für die Tour-Abwicklung gebraucht).
--
-- Idempotent (create or replace / drop policy if exists).
-- Voraussetzungen: Migration 057 (Kundensicht/security_invoker) und
-- 059 (Test-Rolle).
-- ============================================================

-- ------------------------------------------------------------
-- H-1.1 SECURITY-DEFINER-Helper, damit die abhängigen Policies nicht
--       mehr auf der (gleich entfernten) touren-SELECT-Policy für
--       Auftraggeber aufbauen. Beide liefern nur einen Boolean und
--       sind auf den eigenen Auftraggeber beschränkt
--       (current_auftraggeber_id() ist für Nicht-Auftraggeber NULL →
--       Ergebnis false).
-- ------------------------------------------------------------

-- Gehört ein ausgefülltes Formular zu einer Tour meines Auftraggebers?
-- (Verknüpfung via eingang_id / eingang_id_bc oder daten->>'_tour_id'.)
create or replace function public.af_gehoert_zu_meinem_ag(
  p_formular_id uuid,
  p_tour_id_text text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.touren t
    where t.auftraggeber_id = public.current_auftraggeber_id()
      and (
        t.eingang_id = p_formular_id
        or t.eingang_id_bc = p_formular_id
        or t.id::text = p_tour_id_text
      )
  );
$$;

grant execute on function public.af_gehoert_zu_meinem_ag(uuid, text) to authenticated;

-- Gehört eine Tour zu meinem Auftraggeber?
create or replace function public.tour_gehoert_zu_meinem_ag(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.touren t
    where t.id = p_tour_id
      and t.auftraggeber_id = public.current_auftraggeber_id()
  );
$$;

grant execute on function public.tour_gehoert_zu_meinem_ag(uuid) to authenticated;

-- ------------------------------------------------------------
-- H-1.2 SECURITY-DEFINER-Quelle der Kundensicht. Liefert NUR die
--       unkritischen Spalten und beschränkt die Zeilen auf den
--       eigenen Auftraggeber (bestätigte plus selbst erstellte
--       unbestätigte Touren). Für Admin/Fahrer/Test liefert
--       current_auftraggeber_id() NULL → die Funktion gibt 0 Zeilen
--       zurück. Spaltentypen entsprechen exakt public.touren
--       (startdatum/enddatum = date seit 021/028; kontakt_* = jsonb;
--       kennzeichen = text[]; created_at = timestamptz).
-- ------------------------------------------------------------

create or replace function public.touren_kundensicht_rows()
returns table (
  id                   uuid,
  tour_id              text,
  start_stadt          text,
  ziel_stadt           text,
  rueckfuehrung_stadt  text,
  kundenname           text,
  auftraggeber_id      uuid,
  startdatum           date,
  enddatum             date,
  tourenart            text,
  kennzeichen          text[],
  ist_e_fahrzeug       boolean,
  fin                  text,
  adresse_start        text,
  adresse_ziel         text,
  adresse_rueckfuehrung text,
  kontakt_start        jsonb,
  kontakt_ziel         jsonb,
  kontakt_rueckfuehrung jsonb,
  protokoll_art        text,
  info                 text,
  bestaetigt           boolean,
  erstellt_von         uuid,
  created_at           timestamptz,
  eingang_id           uuid,
  eingang_id_bc        uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.tour_id,
    t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt,
    t.kundenname, t.auftraggeber_id,
    t.startdatum, t.enddatum, t.tourenart,
    t.kennzeichen, t.ist_e_fahrzeug, t.fin,
    t.adresse_start, t.adresse_ziel, t.adresse_rueckfuehrung,
    t.kontakt_start, t.kontakt_ziel, t.kontakt_rueckfuehrung,
    t.protokoll_art, t.info,
    t.bestaetigt, t.erstellt_von, t.created_at,
    t.eingang_id, t.eingang_id_bc
  from public.touren t
  where t.auftraggeber_id is not null
    and t.auftraggeber_id = public.current_auftraggeber_id()
    and (t.bestaetigt = true or t.erstellt_von = auth.uid());
$$;

grant execute on function public.touren_kundensicht_rows() to authenticated;

-- ------------------------------------------------------------
-- H-1.3 View neu auf die Funktion stellen. security_invoker bleibt —
--       die View selbst greift nicht mehr direkt auf touren zu,
--       sondern ruft die Definer-Funktion. Der Aufrufer braucht nur
--       EXECUTE auf die Funktion (oben grantet). Frontend
--       (from('touren_kundensicht').select('*')) bleibt unverändert.
-- ------------------------------------------------------------

drop view if exists public.touren_kundensicht;
create view public.touren_kundensicht
  with (security_invoker = true)
as
  select * from public.touren_kundensicht_rows();

grant select on public.touren_kundensicht to authenticated;

-- ------------------------------------------------------------
-- H-1.4 Abhängige Policies auf die Definer-Helper umstellen.
-- ------------------------------------------------------------

drop policy if exists af_auftraggeber_read on public.ausgefuellte_formulare;
create policy af_auftraggeber_read on public.ausgefuellte_formulare
  for select using (
    public.is_auftraggeber()
    and public.af_gehoert_zu_meinem_ag(id, daten->>'_tour_id')
  );

drop policy if exists tpz_auftraggeber_read on public.tour_protokoll_zuweisungen;
create policy tpz_auftraggeber_read on public.tour_protokoll_zuweisungen
  for select using (
    public.tour_gehoert_zu_meinem_ag(tour_id)
  );

-- ------------------------------------------------------------
-- H-1.5 Die breite SELECT-Policy für Auftraggeber auf touren
--       ENTFERNEN. Danach hat ein Auftraggeber keinen direkten
--       Zeilenzugriff auf touren mehr — Lesen läuft nur noch über die
--       Kundensicht-Funktion. INSERT/DELETE-Policies (eigene,
--       unbestätigte Touren) bleiben unangetastet.
-- ------------------------------------------------------------

drop policy if exists touren_auftraggeber_read on public.touren;

-- ------------------------------------------------------------
-- M-1 rechnungsadressen: Lesen nur noch Admin (Test via 059).
-- ------------------------------------------------------------

drop policy if exists rechnungsadressen_read on public.rechnungsadressen;
create policy rechnungsadressen_read on public.rechnungsadressen
  for select using (public.is_admin());

-- ------------------------------------------------------------
-- M-2 preisstufen / sonderverguetungen: Lesen nur noch Admin + Test.
--      Fahrer + Auftraggeber raus.
-- ------------------------------------------------------------

drop policy if exists preisstufen_read on public.preisstufen;
create policy preisstufen_read on public.preisstufen
  for select using (public.is_admin() or public.is_test());

drop policy if exists sonderverguetungen_read on public.sonderverguetungen;
create policy sonderverguetungen_read on public.sonderverguetungen
  for select using (public.is_admin() or public.is_test());

notify pgrst, 'reload schema';
