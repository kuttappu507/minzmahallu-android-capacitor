-- V022 (formerly V014_restore_certificate_status): restore the status column on
-- certificates that V012_add_marriage_noc_certificate.sql omitted.
-- Renamed from V014 to fix a version-number collision that caused this migration to be
-- silently skipped on existing databases (V014_reset_and_seed_large_demo.sql won
-- the alphabetical sort and consumed version 14).
-- The ALTER is idempotent via the migration runner's duplicate-column reconciliation.
ALTER TABLE certificates ADD COLUMN status TEXT NOT NULL DEFAULT 'Issued';
