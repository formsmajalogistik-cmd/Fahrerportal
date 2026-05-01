-- ============================================================
-- Maja-Logistik Business-Portal — 009: Email-Konfiguration pro Template
-- ------------------------------------------------------------
-- Pro formular_template kann eine Email-Konfiguration hinterlegt werden.
-- Format des JSON:
--   {
--     "to":              "kunde@example.com,disposition@maja-logistik.de",
--     "cc":              "{email_kunde}",
--     "subject_pattern": "Fahrzeugprotokoll {kennzeichen}",
--     "body_pattern":    "Hallo, anbei das Protokoll für {kennzeichen}.",
--     "attach_pdf_ids":  ["protokoll", "fotos"]
--   }
-- ============================================================

alter table public.formular_templates
  add column if not exists email_config jsonb;
