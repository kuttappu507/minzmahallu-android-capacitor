-- V020 (formerly V013_financial_crud_compatibility): complete SQLite compatibility for current module CRUD.
-- Renamed from V013 to fix a version-number collision that caused this migration to be
-- silently skipped on existing databases (see V012_add_marriage_noc_certificate.sql which
-- won the alphabetical sort and consumed version 12).
--
-- The ALTER TABLE statements below are idempotent via the migration runner's
-- "duplicate column" reconciliation: if ensureRuntimeSchema() or V014 already added
-- the column, the ALTER fails harmlessly and the migration is marked applied.
ALTER TABLE donations ADD COLUMN updated_at TEXT;
ALTER TABLE transactions ADD COLUMN transaction_ref TEXT;
ALTER TABLE transactions ADD COLUMN updated_at TEXT;
ALTER TABLE audit_log ADD COLUMN metadata TEXT;

-- NOTE: the original migration tried to backfill transaction_ref from a legacy
-- `reference` column. That column does not exist on any supported schema
-- (V014_reset_and_seed_large_demo.sql already added transaction_ref directly),
-- so the UPDATE has been removed to avoid a "no such column: reference" failure
-- that would abort this migration on every existing database.
