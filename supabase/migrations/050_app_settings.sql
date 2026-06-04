-- ============================================================
-- Maja-Logistik Business-Portal — 050: App-Settings + E-Mail-
-- Postfächer für den Posteingang.
-- ------------------------------------------------------------
-- Kleine Schlüssel-Wert-Tabelle für globale App-Einstellungen
-- (zunächst nur die zwei Mailbox-Adressen). Admin-only via RLS.
-- Werte werden als JSONB gespeichert, damit Listen / Strukturen
-- mit gleichem Schema durchgereicht werden können.
-- ============================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- Default-Einträge, damit die Einstellungs-Seite nicht mit leerem
-- Formular startet. Werte können vom Admin überschrieben werden.
insert into public.app_settings (key, value)
values
  ('mail_inbox_1', '{"address":"info@maja-logistik.de","label":"Info"}'::jsonb),
  ('mail_inbox_2', '{"address":"protokollierung@maja-logistik.de","label":"Protokollierung"}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
