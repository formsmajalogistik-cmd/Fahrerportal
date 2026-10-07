-- Protokoll: Änderungen der E-Mail-Adresse eines Kontos.
--
-- Die Adresse ist Login (auth.users) und Zustelladresse (app_users) in
-- einem; geändert wird sie ausschließlich vom Admin über
-- /api/account?action=change-email (Service-Role). Jede Änderung landet
-- hier: wer, wann, von welcher auf welche Adresse, ob die Info-Mail an
-- die neue Adresse rausging.
--
-- Lesen: Admins (und die schreibgeschützte Test-Rolle). Schreiben: nur
-- die Function — sie nutzt den Service-Role-Key und umgeht RLS; für
-- angemeldete Nutzer gibt es keine Schreib-Policy.

create table if not exists public.konto_email_aenderungen (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null,
  alte_email            text not null,
  neue_email            text not null,
  geaendert_von         uuid not null,
  geaendert_von_name    text,
  am                    timestamptz not null default now(),
  -- 'gesendet' oder 'fehler: …'
  info_mail             text,
  -- Wie viele Einträge im Empfänger-Adressbuch mitgezogen wurden.
  adressbuch_eintraege  int not null default 0
);

create index if not exists konto_email_aenderungen_user_idx
  on public.konto_email_aenderungen (user_id, am desc);

alter table public.konto_email_aenderungen enable row level security;

drop policy if exists kea_admin_read on public.konto_email_aenderungen;
create policy kea_admin_read on public.konto_email_aenderungen
  for select using (public.is_admin() or public.is_test());

grant select on public.konto_email_aenderungen to authenticated;

notify pgrst, 'reload schema';
