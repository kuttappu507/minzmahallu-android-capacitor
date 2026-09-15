-- V018: normalize token numbers and enforce database-level uniqueness.
-- Tokens are intentionally four-character alphanumeric codes. Existing test/demo
-- rows are regenerated from their immutable assignment id so every code is unique.
UPDATE token_assignments
SET token_code = printf('%04X', id)
WHERE id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_assignments_token_code_unique
  ON token_assignments(token_code);

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (18, 'Security: normalize token numbers to unique four-character alphanumeric codes');
