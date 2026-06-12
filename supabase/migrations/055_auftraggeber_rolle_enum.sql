-- ============================================================
-- Maja-Logistik Business-Portal — 055: Rolle "auftraggeber" (Enum)
-- ------------------------------------------------------------
-- Eigene Migration NUR für den Enum-Wert: ALTER TYPE ... ADD VALUE
-- darf in derselben Transaktion nicht zusammen mit Statements laufen,
-- die den neuen Wert bereits benutzen (Postgres-Einschränkung).
-- Alles Weitere (Spalten, Policies, Tabellen) folgt in 056.
-- ============================================================

alter type user_role add value if not exists 'auftraggeber';
