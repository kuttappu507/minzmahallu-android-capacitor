-- V005: Add missing columns to token tables for full token workflow
-- Adds: venue, event_time to token_events
-- Adds: status, collected_by, cancelled_at, cancelled_reason, replacement_for to token_assignments

-- token_events: add venue and event_time
ALTER TABLE token_events ADD COLUMN venue TEXT;
ALTER TABLE token_events ADD COLUMN event_time TEXT;

-- token_assignments: add status lifecycle, collected_by, cancellation, replacement
ALTER TABLE token_assignments ADD COLUMN status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','ISSUED','COLLECTED','CANCELLED'));
ALTER TABLE token_assignments ADD COLUMN collected_by INTEGER;
ALTER TABLE token_assignments ADD COLUMN cancelled_at TEXT;
ALTER TABLE token_assignments ADD COLUMN cancelled_reason TEXT;
ALTER TABLE token_assignments ADD COLUMN replacement_for INTEGER;

-- Update existing rows: map collected=1 to status='COLLECTED'
UPDATE token_assignments SET status = 'COLLECTED' WHERE collected = 1;

-- Add unique constraint on event_id + family_id (for duplicate protection)
-- SQLite doesn't support IF NOT EXISTS for indexes, so we check
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_event_family ON token_assignments(event_id, family_id) WHERE status != 'CANCELLED';
