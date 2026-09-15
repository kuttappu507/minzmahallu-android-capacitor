-- V017: align renderer/service fields with SQLite schema for writes and edits.
ALTER TABLE donations ADD COLUMN transaction_ref TEXT;
ALTER TABLE donations ADD COLUMN updated_at TEXT;
-- Accounting columns are normally added by V014 for the reset/demo database; the
-- guarded migration runner will treat already-existing columns as idempotent.
ALTER TABLE transactions ADD COLUMN transaction_ref TEXT;
ALTER TABLE transactions ADD COLUMN updated_at TEXT;
