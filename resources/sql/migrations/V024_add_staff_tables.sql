-- V024: add Staff management module — staff directory + salary payments.
-- Staff are mahallu employees/workers (Imam, Muazzin, Khadim, Secretary,
-- Treasurer, Committee Members, Madrasa Teachers, Cleaner, Security, etc.).
-- Optionally linked to an existing member record via member_id (nullable).
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS staff (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_code          TEXT NOT NULL UNIQUE,
  member_id           INTEGER,                       -- nullable link to members.id
  name                TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'Staff',
  phone               TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  joined_date         TEXT,
  salary              REAL NOT NULL DEFAULT 0,
  payment_frequency   TEXT NOT NULL DEFAULT 'Monthly' CHECK (payment_frequency IN ('Monthly','Quarterly','Annually','OnDemand')),
  status              TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Resigned')),
  notes               TEXT DEFAULT '',
  archive_state       INTEGER NOT NULL DEFAULT 0,    -- 0 = active, 1 = archived
  archive_source      TEXT,                          -- 'manual' (future use)
  archived_at         TEXT,
  archived_by         INTEGER,
  archive_reason      TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_code ON staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status, archive_state);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);

CREATE TABLE IF NOT EXISTS staff_payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id          INTEGER NOT NULL,
  period_month      INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year       INTEGER NOT NULL,
  amount            REAL NOT NULL DEFAULT 0,
  payment_date      TEXT NOT NULL DEFAULT (date('now')),
  payment_method    TEXT DEFAULT 'Cash',
  transaction_ref   TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'Paid' CHECK (status IN ('Paid','Pending','Cancelled')),
  notes             TEXT DEFAULT '',
  paid_by           INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
  FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_payments_staff ON staff_payments(staff_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_staff_payments_period ON staff_payments(period_year, period_month);

-- Audit trigger: keep updated_at in sync.
CREATE TRIGGER IF NOT EXISTS trg_staff_updated AFTER UPDATE ON staff BEGIN
  UPDATE staff SET updated_at = datetime('now') WHERE id = NEW.id;
END;
