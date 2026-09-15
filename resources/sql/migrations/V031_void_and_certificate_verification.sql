-- V031: Receipt VOID workflow + certificate anti-forgery fields.
--
-- Column additions (transactions.status/voided_at/voided_by/void_reason,
-- certificates.verification_code/reprint_count) are guaranteed by the runtime
-- schema reconciliation (ensureRuntimeSchema) before migrations run. This
-- migration only records the version.

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (31, 'Receipt VOID workflow, certificate verification codes, reprint watermark');
