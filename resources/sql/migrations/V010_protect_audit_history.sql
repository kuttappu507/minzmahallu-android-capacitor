-- V010: Audit and record history are append-only historical evidence.
-- Corrections must be represented by a new audit/history entry, never by
-- mutating or deleting the original record.

CREATE TRIGGER IF NOT EXISTS trg_block_audit_log_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be modified');
END;

CREATE TRIGGER IF NOT EXISTS trg_block_audit_log_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS trg_block_record_history_update
BEFORE UPDATE ON record_history
BEGIN
  SELECT RAISE(ABORT, 'Record history entries cannot be modified');
END;

CREATE TRIGGER IF NOT EXISTS trg_block_record_history_delete
BEFORE DELETE ON record_history
BEGIN
  SELECT RAISE(ABORT, 'Record history entries cannot be deleted');
END;

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (10, 'Security: audit log and record history are append-only');
