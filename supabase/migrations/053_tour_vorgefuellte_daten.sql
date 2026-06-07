-- Vorausfüllung pro Tour-Protokoll.
--
-- Wenn ein Template als „vorausfüllbar" konfiguriert ist, trägt der
-- Admin bei der Tour-Zuweisung Werte ein, die beim Öffnen des Formulars
-- in den Initial-State gemergt werden. Schema:
--
--   { "<feld_id>": "wert", ... }
--
-- Felder, deren prefill.enabled=false ist, werden hier nicht abgelegt.

alter table public.touren
  add column if not exists vorgefuellte_daten jsonb;
