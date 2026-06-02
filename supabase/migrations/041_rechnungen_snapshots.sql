-- ============================================================
-- Maja-Logistik Business-Portal — 041: Rechnungsmodul-Fixes
-- ------------------------------------------------------------
-- Schritt 1.5 — Folgeanpassungen zum Rechnungsmodul (Migration 040):
--
--   1) Rechnungs-Kopfdaten als FESTE Snapshots auf der Rechnung
--      speichern (kundennummer, sachbearbeiter, ansprechpartner,
--      Adress-Felder). Damit ändert sich die ausgestellte Rechnung
--      nicht mehr, wenn die Auftraggeber-Stammdaten später angepasst
--      werden — Buchhaltungs-Anforderung.
--   2) Rechnungsformat erhält das Feld zusaetze_auf_touren_rechnung
--      (Liste von Kategorien). Bei getrennter Auslagen-Rechnung
--      gehören Zusätze dieser Kategorien auf die Touren-Rechnung
--      statt auf die Auslagen-Rechnung (CC-Sonderfall: Rote
--      Kennzeichen, Wartezeit).
-- ============================================================

alter table public.rechnungen
  add column if not exists ansprechpartner          text,
  add column if not exists sachbearbeiter           text,
  add column if not exists kundennummer             text,
  add column if not exists rechnungsadresse_firma   text,
  add column if not exists rechnungsadresse_strasse text,
  add column if not exists rechnungsadresse_plz_ort text,
  add column if not exists rechnungsadresse_land    text;

-- ------------------------------------------------------------
-- Bestandsdaten: CC-Auftraggeber (cc_touren-Vorlage) bekommen
-- die Standard-Liste "Rote Kennzeichen" + "Wartezeit" gesetzt,
-- damit der Wechsel auf das neue Feld nicht ihre laufenden
-- Konfigurationen aushebelt.
-- ------------------------------------------------------------
update public.auftraggeber
   set rechnungsformat = jsonb_set(
         rechnungsformat,
         '{zusaetze_auf_touren_rechnung}',
         '["Rote Kennzeichen","Wartezeit"]'::jsonb,
         true
       )
 where rechnungsformat is not null
   and rechnungsformat->>'format_typ' = 'cc_touren'
   and not (rechnungsformat ? 'zusaetze_auf_touren_rechnung');

notify pgrst, 'reload schema';
