-- E-Mail-Versand-Log pro eingereichtem Formular.
--
-- Nach dem Wegfall der automatischen PDF-Pipeline gibt es zwei
-- automatische Mails am Submit (Bestätigung + Schieberegler-Mails).
-- Wir loggen pro Versuch Empfänger, Zeitpunkt und Erfolgs-Status,
-- damit der Admin in Eingänge sieht, was rausging und was nicht.

alter table public.ausgefuellte_formulare
  add column if not exists email_send_log jsonb not null default '[]'::jsonb;
