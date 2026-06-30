-- ============================================================
-- Maja-Logistik Business-Portal — 065: Einmal-Templates archivieren
-- ------------------------------------------------------------
-- Manche Template-Kopien werden nur für EINE einmalige Situation
-- erstellt. Nach der Einreichung „verstopfen" sie die Template-Liste,
-- lassen sich aber nicht löschen (ein eingereichtes Formular hängt
-- daran → FK).
--
-- Lösung (Variante B): ARCHIVIEREN statt löschen. Das Template wird aus
-- Auswahl- und Übersichtslisten ausgeblendet, bleibt aber technisch in
-- der DB → eingereichte Formulare + PDF-Generierung bleiben intakt.
--
-- 1) ist_einmalig: Admin markiert ein Template als Einmal-Verwendung.
-- 2) archiviert / archiviert_am: Archiv-Status.
-- 3) Trigger: beim Wechsel eines Formulars auf status='submitted' wird
--    ein als einmalig markiertes Template automatisch archiviert. Der
--    Trigger läuft SECURITY DEFINER, weil der einreichende Fahrer selbst
--    KEIN Schreibrecht auf formular_templates hat (templates_admin_write).
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Spalten
-- ------------------------------------------------------------

alter table public.formular_templates
  add column if not exists ist_einmalig  boolean not null default false,
  add column if not exists archiviert    boolean not null default false,
  add column if not exists archiviert_am timestamptz;

comment on column public.formular_templates.ist_einmalig is
  'Einmal-Verwendung: nach der ersten Einreichung automatisch archivieren.';
comment on column public.formular_templates.archiviert is
  'Archiviert → aus Auswahl-/Übersichtslisten ausgeblendet, bleibt aber in '
  'der DB, damit eingereichte Formulare + PDF-Mapping funktionieren.';

-- Übersichtslisten filtern auf archiviert=false → Teil-Index.
create index if not exists idx_templates_aktiv
  on public.formular_templates(id) where archiviert = false;

-- ------------------------------------------------------------
-- 2. Auto-Archivierung bei Einreichung (Trigger)
-- ------------------------------------------------------------
-- SECURITY DEFINER: umgeht RLS auf formular_templates, damit auch die
-- Einreichung durch einen Fahrer das (einmalige) Template archivieren
-- kann. search_path fix gesetzt (Hardening).

create or replace function public.fn_archive_einmalig_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nur beim ÜBERGANG auf 'submitted' (Insert mit submitted oder Update
  -- von !=submitted auf submitted) — nicht bei jeder Änderung danach.
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    update public.formular_templates t
       set archiviert    = true,
           archiviert_am = coalesce(t.archiviert_am, now())
     where t.id = new.template_id
       and t.ist_einmalig = true
       and t.archiviert = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_archive_einmalig on public.ausgefuellte_formulare;
create trigger trg_archive_einmalig
  after insert or update of status on public.ausgefuellte_formulare
  for each row
  execute function public.fn_archive_einmalig_template();

notify pgrst, 'reload schema';
