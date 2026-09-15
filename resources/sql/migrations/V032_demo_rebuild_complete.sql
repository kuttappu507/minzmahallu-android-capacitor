-- ============================================================================
-- V032: RETIRED — was "demo rebuild: wipe everything, load a demo dataset".
--
-- WHY RETIRED (security audit): this file ran AUTOMATICALLY on every database
-- that had not yet reached version 32 — including REAL mahallu databases
-- upgraded from an older build and every fresh install. It:
--   * DELETEd every family, member, transaction, donation, subscription,
--     certificate, token, staff/committee row, the whole audit trail and all
--     non-admin users, then loaded a demo dataset in their place;
--   * reset the administrator's password (id=1) to a hash whose plaintext
--     ("Admin@2026") was publicly committed in this repository, and created
--     three demo users whose "Demo@2026" password was equally public;
--   * reset the audit chain, destroying tamper-evidence for prior history.
-- That is a data-loss and god-mode hazard, not a migration.
--
-- Databases that ALREADY ran V032 keep their schema_version=32 record, so this
-- stub never re-executes there and their (already demo) state is unchanged.
-- Every database that has NOT run it — real upgrades and fresh installs — now
-- simply skips the destruction. Fresh installs create their Administrator
-- through the first-run setup screen (no shipped credentials anywhere), and
-- V035 forces rotation of any account still carrying a publicly-committed
-- password hash.
--
-- The demo dataset this migration used to load is gone by design. If demo
-- data is ever needed again, it must be an explicit, opt-in tool — never an
-- unconditionally-applied numbered migration.
-- ============================================================================

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (32, 'RETIRED demo rebuild — stub kept so already-migrated DBs stay consistent');
