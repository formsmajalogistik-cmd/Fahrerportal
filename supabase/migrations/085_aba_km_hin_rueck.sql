-- Migration 085: km Hin und Rück auch für ABA-Touren
--
-- Hintergrund
-- -----------
-- Bisher hatte eine ABA-Tour im Formular nur EIN km-Feld ("Kilometer
-- gesamt"). Dieses wurde in `km_hin` UND `km_gesamt` geschrieben,
-- `km_rueck` blieb null. Ab sofort können bei ABA — wie bei ABC —
-- beide Strecken getrennt erfasst werden.
--
-- Abrechnungsregel (bewusst NICHT die Summe):
--   * ABA, Standard  → der Preis wird ausschließlich über `km_hin`
--                      ermittelt. `km_rueck` ist reine Dokumentation.
--   * ABA, Ausnahme  → `aba_gesamt_km_berechnen = true`: der Preis wird
--                      über `km_gesamt` (Hin + Rück) ermittelt.
--   * ABC / AB       → unverändert (`km_gesamt`).
-- `km_gesamt` wird bei ABA weiterhin als Summe geführt (Anzeige,
-- Rechnungs-Platzhalter {km}) — nur die Preisstufen-Suche greift auf
-- `km_hin` zu.

alter table public.touren
  add column if not exists aba_gesamt_km_berechnen boolean not null default false;

comment on column public.touren.aba_gesamt_km_berechnen is
  'Nur ABA: true = Preis über km_gesamt (Hin+Rück), false (Standard) = Preis über km_hin. Rein abrechnungsrelevant — für Auftraggeber weder sichtbar noch änderbar.';

-- Bestandsschutz
-- --------------
-- Über die Oberfläche angelegte ABA-Touren haben km_hin = km_gesamt
-- (ein einziges Eingabefeld) — für sie ändert die neue Regel den Preis
-- nicht. Anders bei Touren aus dem Excel-Import oder nachträglich auf
-- ABA umgestellten Touren: dort kann km_gesamt <> km_hin sein. Genau
-- diese Zeilen bekommen die Ausnahme-Checkbox gesetzt, damit ihr Preis
-- exakt so bleibt wie bisher. Das ist bewusst KEINE Umrechnung — es
-- friert den Status quo ein. Idempotent: bei einem zweiten Lauf trifft
-- das Update dieselbe Menge.
update public.touren
   set aba_gesamt_km_berechnen = true
 where tourenart = 'ABA'
   and aba_gesamt_km_berechnen = false
   and km_gesamt is not null
   and km_hin is not null
   and km_gesamt <> km_hin;

-- Prüf-Abfrage für den Betrieb (wie viele Touren waren betroffen?):
--   select count(*) from public.touren
--    where tourenart = 'ABA' and aba_gesamt_km_berechnen;

-- Bewusst NICHT ergänzt:
--   * public.ag_tour_felder()  — Auftraggeber dürfen das Feld nicht setzen
--   * public.touren_kundensicht — Auftraggeber sehen das Feld nicht
-- Das Flag ist rein abrechnungsrelevant und gehört damit zu den
-- geschützten Feldern (wie verguetung, fahrer_honorar, barauslagen).
