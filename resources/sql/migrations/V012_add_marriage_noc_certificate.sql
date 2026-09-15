-- V012: add Marriage NOC certificate type.
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS certificates_v012 (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_number  TEXT NOT NULL UNIQUE,
    type                TEXT NOT NULL CHECK (type IN ('Membership','Residence','Marriage','Death','Character','Income','NOC')),
    member_id           INTEGER,
    family_id           INTEGER,
    marriage_id         INTEGER,
    death_id            INTEGER,
    issued_to           TEXT,
    issued_date         TEXT NOT NULL DEFAULT (date('now')),
    issued_by           INTEGER,
    qr_payload          TEXT,
    notes               TEXT,
    status              TEXT NOT NULL DEFAULT 'Issued',
    verification_code   TEXT,
    reprint_count       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL,
    FOREIGN KEY (marriage_id) REFERENCES marriages(id) ON DELETE SET NULL,
    FOREIGN KEY (death_id) REFERENCES deaths(id) ON DELETE SET NULL,
    FOREIGN KEY (issued_by) REFERENCES users(id)
);

INSERT INTO certificates_v012
(id, certificate_number, type, member_id, family_id, marriage_id, death_id, issued_to, issued_date, issued_by, qr_payload, notes, status, verification_code, reprint_count, created_at)
SELECT id, certificate_number, type, member_id, family_id, marriage_id, death_id, issued_to, issued_date, issued_by, qr_payload, notes,
       COALESCE(status, 'Issued'), verification_code, COALESCE(reprint_count, 0), created_at
FROM certificates;

DROP TABLE certificates;
ALTER TABLE certificates_v012 RENAME TO certificates;
CREATE INDEX IF NOT EXISTS idx_cert_type ON certificates(type);
CREATE INDEX IF NOT EXISTS idx_cert_num ON certificates(certificate_number);

PRAGMA foreign_keys=ON;
