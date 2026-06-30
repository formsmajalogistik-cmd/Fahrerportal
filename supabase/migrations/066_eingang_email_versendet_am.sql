-- ============================================================
-- Maja-Logistik Business-Portal — 066: Eingang E-Mail-Versandzeit
-- ------------------------------------------------------------
-- Analog zu rechnungen.email_versendet_am: pro eingereichtem Formular
-- den Zeitpunkt des LETZTEN manuellen E-Mail-Versands aus „Eingänge"
-- festhalten, damit der Admin in der Eingänge-Liste sieht, wann (zuletzt)
-- eine E-Mail rausging.
--
-- Hinweis: email_send_log (jsonb) protokolliert die AUTOMATISCHEN Mails
-- nach Formularabschluss (Bestätigung/Schieberegler). Der manuelle
-- „E-Mail versenden"-Dialog schrieb bisher keinen Zeitstempel — das holt
-- diese Spalte nach.
--
-- Idempotent.
-- ============================================================

alter table public.ausgefuellte_formulare
  add column if not exists email_versendet_am timestamptz;

comment on column public.ausgefuellte_formulare.email_versendet_am is
  'Zeitpunkt des letzten manuellen E-Mail-Versands aus Eingänge (analog '
  'zu rechnungen.email_versendet_am). NULL = noch nicht versendet.';

notify pgrst, 'reload schema';
