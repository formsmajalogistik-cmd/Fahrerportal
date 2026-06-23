-- ============================================================
-- Maja-Logistik Business-Portal — 064: Führerschein manuell erledigen
-- ------------------------------------------------------------
-- Nicht jeder aktive Account reicht (oder muss) einen Führerschein
-- einreichen: Test-Accounts, Disponenten ohne Fahrtätigkeit, extern
-- geprüfte Fahrer usw. Bisher liess sich eine Abfrage deshalb NIE
-- abschliessen, weil immer Einreichungen „fehlten".
--
-- Zwei Mechanismen:
--   1) Pro Abfrage kann ein Account vom Admin MANUELL als erledigt
--      markiert werden (auch ohne Einreichung). Es entsteht ein
--      Einreichungs-Datensatz mit `manuell_erledigt = true` und einer
--      optionalen Begründung — KEINE Bilder. Visuell unterscheidbar von
--      echten, geprüften Einreichungen.
--   2) Ein Account kann DAUERHAFT von Führerscheinabfragen ausgenommen
--      werden (`fahrer.fs_ausgenommen`), damit er nicht bei jeder neuen
--      Abfrage erneut manuell erledigt werden muss und kein Popup erhält.
--
-- Idempotent. Voraussetzung: 061 (fuehrerschein), is_admin() (001).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Einreichungen: manuelle Erledigung
-- ------------------------------------------------------------

alter table public.fuehrerschein_einreichungen
  add column if not exists manuell_erledigt boolean not null default false,
  add column if not exists manuell_grund    text;

comment on column public.fuehrerschein_einreichungen.manuell_erledigt is
  'Vom Admin ohne echte Einreichung als erledigt markiert (kein Bild). '
  'geprueft_am/geprueft_von dokumentieren wer/wann.';
comment on column public.fuehrerschein_einreichungen.manuell_grund is
  'Optionaler Grund der manuellen Erledigung (z.B. "fährt nicht", "extern geprüft").';

-- ------------------------------------------------------------
-- 2. Fahrer: dauerhafte Ausnahme von Führerscheinabfragen
-- ------------------------------------------------------------

alter table public.fahrer
  add column if not exists fs_ausgenommen boolean not null default false;

comment on column public.fahrer.fs_ausgenommen is
  'Dauerhaft von Führerscheinabfragen ausgenommen (kein Popup, zählt nicht '
  'zum Soll der Abfrage). z.B. Test-Account oder Account ohne Fahrtätigkeit.';

notify pgrst, 'reload schema';
