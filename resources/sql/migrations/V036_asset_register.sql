-- V036: Asset register — the mahallu's buildings, lands and rentable goods,
-- with the accounting link that lets rent income and repair expenses be
-- tagged to the asset they belong to (the waqf/rental-software pattern).
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  reference_no TEXT DEFAULT '',
  location TEXT DEFAULT '',
  acquisition_date TEXT DEFAULT '',
  acquisition_cost REAL DEFAULT 0,
  current_value REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'In use',
  condition_note TEXT DEFAULT 'Good',
  custodian TEXT DEFAULT '',
  income_generating INTEGER NOT NULL DEFAULT 0,
  tenant_name TEXT DEFAULT '',
  monthly_rent REAL DEFAULT 0,
  agreement_start TEXT DEFAULT '',
  agreement_end TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);

-- Accounting link: a manual income (rent collection) or expense (repairs,
-- tax, upkeep) entry can be tagged with the asset it belongs to.
ALTER TABLE transactions ADD COLUMN asset_id INTEGER REFERENCES assets(id);
CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (36, 'Asset register with accounting link (buildings, lands, rentable goods)');
