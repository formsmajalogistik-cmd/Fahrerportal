-- ============================================================
-- Maja-Logistik Business-Portal — 058: Rolle "test" (Enum)
-- ------------------------------------------------------------
-- Eigene Migration NUR für den Enum-Wert: ALTER TYPE ... ADD VALUE
-- darf nicht in derselben Transaktion mit Statements stehen, die den
-- neuen Wert bereits benutzen (Postgres-Einschränkung). Alle weiteren
-- Policies/Funktionen folgen in 059.
-- ============================================================

alter type user_role add value if not exists 'test';
