-- V025: add Committee management module — elected/nominated committee members
-- with term tracking. Committee members are distinct from Staff (paid employees):
-- they are elected community representatives holding office for a defined term.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS committee_members (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_code      TEXT NOT NULL UNIQUE,
  member_id           INTEGER,                       -- nullable link to members.id
  name                TEXT NOT NULL,
  position            TEXT NOT NULL DEFAULT 'Committee Member',
  committee_type      TEXT NOT NULL DEFAULT 'Executive' CHECK (committee_type IN ('Executive','Advisory','Working','Sub-Committee','Trust')),
  phone               TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  term_start          TEXT,
  term_end            TEXT,
  status              TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Past','Resigned')),
  notes               TEXT DEFAULT '',
  archive_state       INTEGER NOT NULL DEFAULT 0,
  archive_source      TEXT,
  archived_at         TEXT,
  archived_by         INTEGER,
  archive_reason      TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_committee_code ON committee_members(committee_code);
CREATE INDEX IF NOT EXISTS idx_committee_status ON committee_members(status, archive_state);
CREATE INDEX IF NOT EXISTS idx_committee_position ON committee_members(position);
CREATE INDEX IF NOT EXISTS idx_committee_type ON committee_members(committee_type);
CREATE INDEX IF NOT EXISTS idx_committee_term_end ON committee_members(term_end);

CREATE TRIGGER IF NOT EXISTS trg_committee_updated AFTER UPDATE ON committee_members BEGIN
  UPDATE committee_members SET updated_at = datetime('now') WHERE id = NEW.id;
END;
