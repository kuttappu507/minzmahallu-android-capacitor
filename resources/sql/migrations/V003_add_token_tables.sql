-- V003: Add token distribution tables
-- Note: schema_version insert is handled by the migration runner
-- (Database.applyMigrations in connection.ts), NOT by this file.
CREATE TABLE IF NOT EXISTS token_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'general',
    event_date TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS token_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    family_id INTEGER NOT NULL,
    token_code TEXT NOT NULL UNIQUE,
    collected INTEGER NOT NULL DEFAULT 0,
    collected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES token_events(id) ON DELETE CASCADE,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_assignments_event ON token_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_token_assignments_family ON token_assignments(family_id);
CREATE INDEX IF NOT EXISTS idx_token_assignments_code ON token_assignments(token_code);
