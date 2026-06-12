-- ============================================================
-- Maja-Logistik Business-Portal — 056: Rolle "auftraggeber"
-- ------------------------------------------------------------
-- Externe Kunden-Profile mit stark eingeschränkter Sicht:
--   * sehen NUR Touren des eigenen Auftraggebers — und davon nur
--     bestätigte plus selbst erstellte unbestätigte ("In Prüfung")
--   * sehen NIEMALS Preise, Vergütungen, Fahrer-Daten oder Touren
--     anderer Auftraggeber
--   * können Touren anlegen (landen unbestätigt beim Admin)
--   * sehen nur explizit freigegebene Templates
--   * können Formular-Wünsche (PDF + Notiz) einreichen
--
-- Sicherheits-Architektur:
--   1. KEINE SELECT-Policy auf public.touren für Auftraggeber —
--      direkte Tabellen-Queries liefern für diese Rolle IMMER 0 Zeilen.
--   2. Lesezugriff ausschließlich über die View touren_kundensicht,
--      die nur unkritische Spalten enthält (keine verguetung, kein
--      fahrer_id/fahrer_honorar/barauslagen) und in ihrem WHERE den
--      Auftraggeber-Scope erzwingt. Preis-Spalten sind damit auf
--      DB-Ebene unerreichbar — nicht nur im Frontend ausgeblendet.
--   3. Preis-/Stammdaten-Tabellen, die bisher für alle Authenticated
--      lesbar waren (preisstufen, sonderverguetungen, auftraggeber,
--      auftraggeber_kontakte, greimel sichtbar_fuer_alle), werden für
--      die Rolle auftraggeber dichtgemacht.
--
-- Reihenfolge dieser Datei (wichtig — Postgres validiert SQL-Funktions-
-- Bodies beim Anlegen):
--   1. Alle ALTER TABLE ... ADD COLUMN (idempotent via IF NOT EXISTS)
--   2. Neue Tabellen
--   3. Helper-Funktionen (referenzieren die neuen Spalten)
--   4. View
--   5. Policies + RPC
--
-- Voraussetzung: Migration 055 (Enum-Wert 'auftraggeber') ist gelaufen.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Spalten anlegen — MUSS vor den Funktionen passieren.
-- ------------------------------------------------------------

-- Verknüpfung Profil → GENAU EIN Auftraggeber.
alter table public.app_users
  add column if not exists auftraggeber_id uuid references public.auftraggeber(id) on delete set null;

-- Bestätigungs-Workflow: von Auftraggebern erstellte Touren starten
-- unbestätigt; bestehende und Admin-Touren sind automatisch bestätigt.
alter table public.touren
  add column if not exists bestaetigt boolean not null default true,
  add column if not exists erstellt_von uuid references public.app_users(id) on delete set null,
  add column if not exists erstellt_von_rolle text;

create index if not exists idx_touren_bestaetigt on public.touren(bestaetigt) where bestaetigt = false;

-- ------------------------------------------------------------
-- 2. Neue Tabellen
-- ------------------------------------------------------------

-- Multi-Select-Freigabe: welche Auftraggeber dürfen ein Template sehen
-- und ihren Touren zuweisen?
create table if not exists public.template_auftraggeber_freigaben (
  template_id     uuid not null references public.formular_templates(id) on delete cascade,
  auftraggeber_id uuid not null references public.auftraggeber(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (template_id, auftraggeber_id)
);

alter table public.template_auftraggeber_freigaben enable row level security;

-- Formular-Wünsche: PDF-Vorlagen, die Auftraggeber einreichen können.
create table if not exists public.formular_wuensche (
  id               uuid primary key default gen_random_uuid(),
  auftraggeber_id  uuid not null references public.auftraggeber(id) on delete cascade,
  eingereicht_von  uuid references public.app_users(id) on delete set null,
  pdf_url          text not null,
  notiz            text,
  status           text not null default 'offen' check (status in ('offen', 'erledigt')),
  created_at       timestamptz not null default now()
);

create index if not exists idx_formular_wuensche_status on public.formular_wuensche(status);

alter table public.formular_wuensche enable row level security;

-- ------------------------------------------------------------
-- 3. Helper-Funktionen — referenzieren die in Schritt 1 angelegten
--    Spalten (`role` aus 001, `auftraggeber_id` aus diesem Schritt).
-- ------------------------------------------------------------

create or replace function public.is_auftraggeber()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'auftraggeber'
  );
$$;

grant execute on function public.is_auftraggeber() to authenticated;

-- Liefert die auftraggeber_id des eingeloggten Auftraggeber-Profils —
-- für Admin/Fahrer NULL (Vergleiche mit NULL matchen nie → 0 Zeilen).
create or replace function public.current_auftraggeber_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auftraggeber_id from public.app_users
  where id = auth.uid() and role = 'auftraggeber';
$$;

grant execute on function public.current_auftraggeber_id() to authenticated;

-- ------------------------------------------------------------
-- 4. Kunden-View: einzige Lesequelle für Auftraggeber-Profile.
--    Security-Definer-Semantik (View-Owner umgeht RLS auf touren),
--    deshalb MUSS das WHERE den Scope vollständig erzwingen:
--      * nur Touren des eigenen Auftraggebers
--      * nur bestätigte ODER selbst erstellte
--    Für Admin/Fahrer liefert current_auftraggeber_id() NULL → View leer.
-- ------------------------------------------------------------

drop view if exists public.touren_kundensicht;
create view public.touren_kundensicht as
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

grant select on public.touren_kundensicht to authenticated;

-- ------------------------------------------------------------
-- 5. RLS touren: INSERT/DELETE für Auftraggeber.
--    Bewusst KEINE SELECT- und KEINE UPDATE-Policy: Lesen läuft über
--    die View; bestätigte Touren sind für die Rolle unveränderlich.
-- ------------------------------------------------------------

drop policy if exists touren_auftraggeber_insert on public.touren;
create policy touren_auftraggeber_insert on public.touren
  for insert with check (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
    and bestaetigt = false
    and erstellt_von = auth.uid()
    -- Preis-/Fahrer-Felder dürfen beim Anlegen nicht gesetzt werden.
    and fahrer_id is null
    and verguetung is null
    and coalesce(barauslagen, 0) = 0
    and coalesce(fahrer_honorar, 0) = 0
  );

-- Eigene, noch unbestätigte Touren dürfen wieder gelöscht werden.
drop policy if exists touren_auftraggeber_delete on public.touren;
create policy touren_auftraggeber_delete on public.touren
  for delete using (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
    and erstellt_von = auth.uid()
    and bestaetigt = false
  );

-- ------------------------------------------------------------
-- 6. RLS ausgefuellte_formulare: Auftraggeber liest Formulare,
--    die mit Touren des EIGENEN Auftraggebers verknüpft sind
--    (über eingang_id / eingang_id_bc oder daten->>'_tour_id').
-- ------------------------------------------------------------

drop policy if exists af_auftraggeber_read on public.ausgefuellte_formulare;
create policy af_auftraggeber_read on public.ausgefuellte_formulare
  for select using (
    public.is_auftraggeber()
    and exists (
      select 1 from public.touren t
      where t.auftraggeber_id = public.current_auftraggeber_id()
        and (
          t.eingang_id = ausgefuellte_formulare.id
          or t.eingang_id_bc = ausgefuellte_formulare.id
          or t.id::text = ausgefuellte_formulare.daten->>'_tour_id'
        )
    )
  );

-- ------------------------------------------------------------
-- 7. Template-Freigaben Policies
-- ------------------------------------------------------------

drop policy if exists taf_admin_all on public.template_auftraggeber_freigaben;
create policy taf_admin_all on public.template_auftraggeber_freigaben
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists taf_auftraggeber_read on public.template_auftraggeber_freigaben;
create policy taf_auftraggeber_read on public.template_auftraggeber_freigaben
  for select using (
    auftraggeber_id = public.current_auftraggeber_id()
  );

-- formular_templates: Auftraggeber liest nur freigegebene Templates.
-- Basis ist die Policy aus Migration 023 (templates_visible_read) —
-- die Fahrer-Pfade (sichtbar=true / Tour-Verknüpfung) bleiben identisch,
-- werden aber für die Rolle auftraggeber ausgeschlossen.
drop policy if exists templates_visible_read on public.formular_templates;
create policy templates_visible_read on public.formular_templates
  for select using (
    public.is_admin()
    or (sichtbar = true and not public.is_auftraggeber())
    or (
      not public.is_auftraggeber()
      and exists (
        select 1
        from public.touren t
        join public.fahrer f on f.id = t.fahrer_id
        where t.schriftliches_protokoll_id = formular_templates.id
          and t.protokoll_art = 'schriftlich'
          and f.user_id = auth.uid()
      )
    )
    or exists (
      select 1 from public.template_auftraggeber_freigaben fr
      where fr.template_id = formular_templates.id
        and fr.auftraggeber_id = public.current_auftraggeber_id()
    )
  );

-- ------------------------------------------------------------
-- 8. tour_protokoll_zuweisungen: Auftraggeber liest Zuweisungen
--    der eigenen Touren (für die Formular-Übersicht).
-- ------------------------------------------------------------

drop policy if exists tpz_auftraggeber_read on public.tour_protokoll_zuweisungen;
create policy tpz_auftraggeber_read on public.tour_protokoll_zuweisungen
  for select using (
    exists (
      select 1 from public.touren t
      where t.id = tour_protokoll_zuweisungen.tour_id
        and t.auftraggeber_id = public.current_auftraggeber_id()
    )
  );

-- ------------------------------------------------------------
-- 9. RPC: Formular einer Tour zuweisen (Auftraggeber).
--    SECURITY DEFINER, weil zusätzlich touren.protokoll_art gesetzt
--    werden muss — Auftraggeber haben bewusst keine UPDATE-Policy
--    auf touren. Alle Checks laufen hier serverseitig.
-- ------------------------------------------------------------

create or replace function public.auftraggeber_formular_zuweisen(
  p_tour_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ag uuid;
begin
  v_ag := public.current_auftraggeber_id();
  if v_ag is null then
    raise exception 'Nur Auftraggeber-Profile dürfen diese Funktion nutzen.';
  end if;
  -- Tour muss zum eigenen Auftraggeber gehören.
  if not exists (
    select 1 from public.touren t
    where t.id = p_tour_id and t.auftraggeber_id = v_ag
  ) then
    raise exception 'Tour nicht gefunden oder kein Zugriff.';
  end if;
  -- Template muss für diesen Auftraggeber freigegeben sein.
  if not exists (
    select 1 from public.template_auftraggeber_freigaben fr
    where fr.template_id = p_template_id and fr.auftraggeber_id = v_ag
  ) then
    raise exception 'Template ist für diesen Auftraggeber nicht freigegeben.';
  end if;

  insert into public.tour_protokoll_zuweisungen (tour_id, template_id)
  values (p_tour_id, p_template_id)
  on conflict (tour_id, template_id) do nothing;

  -- Standard-Zuweisung: Tour auf schriftliches Protokoll stellen,
  -- damit die Fahrer-Tourenkarte die Protokoll-Pills anzeigt.
  update public.touren
     set protokoll_art = 'schriftlich'
   where id = p_tour_id
     and (protokoll_art is null or protokoll_art = 'schriftlich');
end;
$$;

grant execute on function public.auftraggeber_formular_zuweisen(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 10. Formular-Wünsche: Policies
-- ------------------------------------------------------------

drop policy if exists fw_admin_all on public.formular_wuensche;
create policy fw_admin_all on public.formular_wuensche
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists fw_auftraggeber_insert on public.formular_wuensche;
create policy fw_auftraggeber_insert on public.formular_wuensche
  for insert with check (
    public.is_auftraggeber()
    and auftraggeber_id = public.current_auftraggeber_id()
    and eingereicht_von = auth.uid()
    and status = 'offen'
  );

drop policy if exists fw_auftraggeber_read on public.formular_wuensche;
create policy fw_auftraggeber_read on public.formular_wuensche
  for select using (
    auftraggeber_id = public.current_auftraggeber_id()
  );

-- ------------------------------------------------------------
-- 11. Bestehende "alle Authenticated dürfen lesen"-Policies für die
--     Rolle auftraggeber dichtmachen — Preise, fremde Stammdaten und
--     Greimel-Zugänge gehen externe Kunden nichts an.
-- ------------------------------------------------------------

-- Preisstufen: nur noch Admin + Fahrer.
drop policy if exists preisstufen_read on public.preisstufen;
create policy preisstufen_read on public.preisstufen
  for select using (
    auth.role() = 'authenticated' and not public.is_auftraggeber()
  );

-- Sondervergütungen: nur noch Admin + Fahrer.
drop policy if exists sonderverguetungen_read on public.sonderverguetungen;
create policy sonderverguetungen_read on public.sonderverguetungen
  for select using (
    auth.role() = 'authenticated' and not public.is_auftraggeber()
  );

-- Auftraggeber-Stammdaten: Auftraggeber-Profile sehen NUR den eigenen
-- Eintrag (enthält aba_aufschlag_prozent, Preislisten-Links etc. —
-- fremde Konditionen bleiben verborgen).
drop policy if exists auftraggeber_read on public.auftraggeber;
create policy auftraggeber_read on public.auftraggeber
  for select using (
    (auth.role() = 'authenticated' and not public.is_auftraggeber())
    or id = public.current_auftraggeber_id()
  );

-- Auftraggeber-Kontakte: gleiche Logik.
drop policy if exists ag_kontakte_read on public.auftraggeber_kontakte;
create policy ag_kontakte_read on public.auftraggeber_kontakte
  for select using (
    (auth.role() = 'authenticated' and not public.is_auftraggeber())
    or auftraggeber_id = public.current_auftraggeber_id()
  );

-- Greimel-Zugänge: "sichtbar_fuer_alle" meint alle FAHRER, nicht Kunden.
drop policy if exists greimel_read on public.greimel_zugaenge;
create policy greimel_read on public.greimel_zugaenge
  for select using (
    public.is_admin()
    or (sichtbar_fuer_alle and not public.is_auftraggeber())
    or exists (
      select 1 from public.fahrer f
      where f.user_id = auth.uid()
        and f.id = any(greimel_zugaenge.fahrer_ids)
    )
  );

notify pgrst, 'reload schema';
