-- V009: Harden destructive token operations and make audit metadata durable.
-- Temporary event tokens may be physically removed only through the authenticated,
-- administrator-only security IPC workflow. The audit row is written in the same
-- transaction as the deletion so a missing/failed audit can never be ignored.

ALTER TABLE audit_log ADD COLUMN metadata TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (9, 'Security: durable audit metadata for authenticated token deletion');
