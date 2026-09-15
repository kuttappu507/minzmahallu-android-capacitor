-- V030: Voucher control fields, family-tree member links, tamper-evident audit chain.
--
-- Column additions (transactions.voucher_no/bill_no/payee, members.father_id/
-- mother_id/spouse_id, audit_log.prev_hash/entry_hash, settings.demo_data) are
-- guaranteed by the runtime schema reconciliation in electron/db/connection.ts
-- (ensureRuntimeSchema), which runs before migrations on every launch. This
-- migration therefore only creates the tamper-evidence anchor table and records
-- the version.

CREATE TABLE IF NOT EXISTS audit_chain (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_hash TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);

INSERT OR IGNORE INTO audit_chain (id, last_hash, event_count) VALUES (1, NULL, 0);

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (30, 'Voucher control fields, family-tree links, tamper-evident audit chain');
