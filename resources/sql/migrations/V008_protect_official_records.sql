-- V008: official issued documents are historical records and must not be hard-deleted.
CREATE TRIGGER IF NOT EXISTS trg_block_certificate_delete
BEFORE DELETE ON certificates
WHEN OLD.status IN ('Issued','Revoked') OR OLD.status IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Certificates cannot be permanently deleted; revoke the certificate instead');
END;

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (8, 'Security: protect official certificates from permanent deletion');
