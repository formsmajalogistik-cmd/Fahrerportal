-- ============================================================
-- Maja-Logistik Business-Portal — 045: E-Mail-Favoriten.
-- ------------------------------------------------------------
-- Backing-Tabelle für den E-Mail-Versand-Dialog (Eingänge):
-- Admins können Empfänger-Adressen als Favoriten markieren, die
-- dann im Dropdown des Versand-Dialogs ganz oben (mit Stern)
-- erscheinen. Adresse wird unique normalisiert (lower-case) gehalten,
-- damit "Max@Beispiel.de" und "max@beispiel.de" denselben Datensatz
-- referenzieren.
-- ============================================================

create table if not exists public.email_favoriten (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  name        text,
  ist_favorit boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Eindeutigkeit case-insensitive: lower(email) muss unique sein,
-- damit dasselbe Postfach nicht doppelt landet.
create unique index if not exists idx_email_favoriten_email_lower
  on public.email_favoriten (lower(email));

-- RLS: nur Admin darf lesen/schreiben — Fahrer haben mit Eingangs-
-- Mails nichts zu tun.
alter table public.email_favoriten enable row level security;

drop policy if exists email_favoriten_admin_all on public.email_favoriten;
create policy email_favoriten_admin_all on public.email_favoriten
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
