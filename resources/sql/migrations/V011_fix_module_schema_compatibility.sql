-- V011: align module CRUD fields with the production schema
ALTER TABLE marriages ADD COLUMN updated_at TEXT;
ALTER TABLE deaths ADD COLUMN updated_at TEXT;
ALTER TABLE welfare_requests ADD COLUMN request_date TEXT;
ALTER TABLE welfare_requests ADD COLUMN rejection_reason TEXT;
ALTER TABLE welfare_requests ADD COLUMN processed_by INTEGER;
ALTER TABLE welfare_requests ADD COLUMN processed_date TEXT;
UPDATE welfare_requests SET request_date = created_at WHERE request_date IS NULL;
