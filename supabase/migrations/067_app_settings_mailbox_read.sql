-- ============================================================
-- Maja-Logistik Business-Portal — 067: Mailbox-Whitelist lesbar
-- ------------------------------------------------------------
-- Bugfix „keine automatischen E-Mails nach Formular-Einreichung":
-- Der Server prüft beim E-Mail-Versand (eingang-send) das `from`-Postfach
-- gegen die Whitelist in app_settings (mail_inbox_1/2) — und zwar MIT dem
-- JWT des Aufrufers (server-lib/mailboxAuth.ts, bewusst kein Service-Key).
--
-- app_settings war bisher komplett admin-only (050). Für den einreichenden
-- FAHRER lieferte der Lookup daher 0 Postfächer → 400 „Keine Postfächer
-- konfiguriert" → jeder automatische Versand (Bestätigung, Self, beide
-- Schieberegler) scheiterte.
--
-- Fix: schmale SELECT-Policy NUR für die beiden Mailbox-Keys für alle
-- Authentifizierten. Die Adressen sind nicht schutzbedürftig (sie stehen
-- als Absender in jeder Mail); alle übrigen app_settings-Keys bleiben
-- admin-only, Schreiben sowieso.
--
-- Idempotent.
-- ============================================================

drop policy if exists app_settings_mailbox_read on public.app_settings;
create policy app_settings_mailbox_read on public.app_settings
  for select using (
    auth.role() = 'authenticated'
    and key in ('mail_inbox_1', 'mail_inbox_2')
  );

notify pgrst, 'reload schema';
