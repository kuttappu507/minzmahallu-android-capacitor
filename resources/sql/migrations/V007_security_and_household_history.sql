-- Security + household history foundation
-- V007: archive metadata, immutable record history, and family move tracking.

ALTER TABLE families ADD COLUMN archived_at TEXT;
ALTER TABLE families ADD COLUMN archived_by INTEGER;
ALTER TABLE families ADD COLUMN archive_reason TEXT;

ALTER TABLE members ADD COLUMN archive_state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN archive_source TEXT;
ALTER TABLE members ADD COLUMN archived_at TEXT;
ALTER TABLE members ADD COLUMN archived_by INTEGER;
ALTER TABLE members ADD COLUMN archive_reason TEXT;

CREATE TABLE IF NOT EXISTS record_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    summary TEXT NOT NULL,
    changes_json TEXT,
    reason TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_record_history_entity ON record_history(entity_type, entity_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS family_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    old_family_id INTEGER NOT NULL,
    new_family_id INTEGER NOT NULL,
    move_type TEXT NOT NULL CHECK (move_type IN ('ExistingFamily','NewFamily')),
    reason TEXT NOT NULL,
    moved_at TEXT NOT NULL DEFAULT (datetime('now')),
    moved_by INTEGER,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
    FOREIGN KEY (old_family_id) REFERENCES families(id) ON DELETE RESTRICT,
    FOREIGN KEY (new_family_id) REFERENCES families(id) ON DELETE RESTRICT,
    FOREIGN KEY (moved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_family_moves_member ON family_moves(member_id, moved_at DESC);

-- Archiving a family archives every currently-active member of that family.
-- Members retain their identity and history; archive_source records that the
-- archive came from the family so a later family restore can safely restore
-- only those members.
CREATE TRIGGER IF NOT EXISTS trg_family_archive_members
AFTER UPDATE OF status ON families
WHEN NEW.status = 'Archived' AND OLD.status <> 'Archived'
BEGIN
  UPDATE members
     SET archive_state = 1,
         archive_source = 'family',
         archived_at = COALESCE(NEW.archived_at, datetime('now')),
         archived_by = NEW.archived_by,
         archive_reason = COALESCE(NEW.archive_reason, 'Family archived'),
         updated_at = datetime('now')
   WHERE family_id = NEW.id AND archive_state = 0;
END;

-- Restore only members that were archived by this family archive operation.
CREATE TRIGGER IF NOT EXISTS trg_family_restore_members
AFTER UPDATE OF status ON families
WHEN NEW.status <> 'Archived' AND OLD.status = 'Archived'
BEGIN
  UPDATE members
     SET archive_state = 0,
         archive_source = NULL,
         archived_at = NULL,
         archived_by = NULL,
         archive_reason = NULL,
         updated_at = datetime('now')
   WHERE family_id = NEW.id AND archive_state = 1 AND archive_source = 'family';
END;

-- Prevent hard deletion of families/members through the normal application
-- once history exists. The application should use archive/move operations.
CREATE TRIGGER IF NOT EXISTS trg_block_family_delete
BEFORE DELETE ON families
BEGIN
  SELECT RAISE(ABORT, 'Families cannot be permanently deleted; archive the family instead');
END;

CREATE TRIGGER IF NOT EXISTS trg_block_member_delete
BEFORE DELETE ON members
BEGIN
  SELECT RAISE(ABORT, 'Members cannot be permanently deleted; archive the member instead');
END;

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (7, 'Security: family/member archive metadata, immutable history, and household move tracking');
