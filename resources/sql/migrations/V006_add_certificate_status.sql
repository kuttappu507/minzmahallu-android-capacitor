-- V006: Add certificate status column used by certificate issuance service.
-- Existing databases may have been created from schema.sql before the
-- certificate service started persisting status.
ALTER TABLE certificates ADD COLUMN status TEXT NOT NULL DEFAULT 'Issued';
