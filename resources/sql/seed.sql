-- MMS Seed Data
-- ============================================================================
-- Only FUNCTIONAL base configuration lives here (settings row, one extra
-- subscription plan). NO user accounts are seeded: every install must create
-- its own Administrator through the first-run setup screen, so no password
-- is ever shipped in this repository. All demo/record data was provided by
-- migration V032, which has been retired (it wiped real data on upgrades and
-- reset credentials to publicly-committed values).
-- ============================================================================
PRAGMA foreign_keys = OFF;

INSERT OR IGNORE INTO settings (id, mahallu_name, theme, language, currency_symbol) VALUES (1, 'Minz Mahallu', 'light', 'en', '₹');

-- schema.sql already inserts default subscription plans via INSERT OR IGNORE.
-- Add an extra 'Special' plan not in the schema defaults:
INSERT OR IGNORE INTO subscription_plans (name, frequency, default_amount, description) VALUES
('Special Subscription','OneTime',0,'Special one-time contribution');

-- schema.sql already inserts default ledger accounts and donation categories
-- via INSERT OR IGNORE — no extra seed accounts needed.
