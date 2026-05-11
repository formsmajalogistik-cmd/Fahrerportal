-- ============================================================
-- Maja-Logistik Business-Portal — 023: Template-Sichtbarkeit &
-- automatische Zuweisung an alle Fahrer
-- ------------------------------------------------------------
-- Templates sind jetzt nicht mehr manuell pro Fahrer zugewiesen,
-- sondern haben eine Sichtbarkeits-Flag. Default = sichtbar.
-- Nicht sichtbare Templates erscheinen für Fahrer nur, wenn sie
-- über eine Tour (protokoll_art = 'schriftlich' +
-- schriftliches_protokoll_id) dem Fahrer zugeordnet sind.
-- ============================================================

alter table public.formular_templates
  add column if not exists sichtbar boolean not null default true;

-- ------------------------------------------------------------
-- Tabelle formular_zuweisungen wird nicht mehr benötigt — alle
-- Fahrer haben implizit Zugriff auf sichtbare Templates.
-- ------------------------------------------------------------
drop table if exists public.formular_zuweisungen cascade;

-- ------------------------------------------------------------
-- RLS für formular_templates neu setzen.
-- Lesen: Admin alles. Fahrer: sichtbar=true ODER Tour-Verknüpfung.
-- ------------------------------------------------------------
drop policy if exists templates_assigned_read on public.formular_templates;
drop policy if exists templates_visible_read on public.formular_templates;
create policy templates_visible_read on public.formular_templates
  for select using (
    public.is_admin()
    or sichtbar = true
    or exists (
      select 1
      from public.touren t
      join public.fahrer f on f.id = t.fahrer_id
      where t.schriftliches_protokoll_id = formular_templates.id
        and t.protokoll_art = 'schriftlich'
        and f.user_id = auth.uid()
    )
  );
