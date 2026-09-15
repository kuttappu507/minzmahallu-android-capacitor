/*
 * Date-based deletion protection for token events — DB-level enforcement.
 *
 * Policy (mirrored at the IPC layer in security-ipc.ts and in
 * data.service.ts, so the app fails with a friendly message BEFORE the
 * trigger ever fires):
 *
 *   1. A token event can be deleted ONLY after its event date is over.
 *      Once the date has passed, the event and its tokens are spent
 *      records — there is no need to keep them — and an Administrator
 *      may delete the event with a reason (audited). Until the date is
 *      over (today, a future date, or a row with no valid date) the
 *      event can NEVER be deleted — neither through the app nor through
 *      an external SQLite editor.
 *   2. Tokens belonging to an upcoming event cannot be deleted either:
 *      families hold those token numbers for an event that has not
 *      happened yet. Tokens of a past event are open to deletion, which
 *      is exactly what the app's audited cleanup flows remove.
 *   3. An upcoming event's date cannot be moved into the past — that
 *      would fake "the event already happened" and bypass rule 1.
 *      Future-to-future postponement and past-to-past corrections stay
 *      allowed.
 *
 * Upgrade note: earlier builds installed the OPPOSITE policy (past
 * events locked as history, upcoming events deletable) through the
 * triggers trg_token_events_block_past_delete,
 * trg_token_assignments_block_past_delete,
 * trg_token_events_block_date_escape and the token_delete_guard one-shot
 * authorization table. The DROP statements below remove those artifacts
 * from existing databases before the new triggers are created, so a
 * single app upgrade flips the policy everywhere. Everything is
 * CREATE/DROP ... IF [NOT] EXISTS, so installation stays idempotent and
 * runs on every boot for databases of any age (the same pattern the
 * token tables themselves use in connection.ts, and the same
 * RAISE(ABORT) guard style used for families / members / certificates /
 * audit_log since V008/V032).
 *
 * Timezone note: the triggers compare against date('now','localtime').
 * MMS is used in India only (see ist-date.ts) and the machine's local
 * timezone is IST, which matches todayIST() used by the app layer. On a
 * misconfigured machine the two could disagree around midnight — the
 * app-layer check is the friendly one; the trigger is the backstop.
 */

/** Minimal interface so this module stays free of Electron imports and
 *  is unit-testable against a plain better-sqlite3 database. */
export interface ExecutableDb {
  exec(sql: string): void;
}

export const TOKEN_DATE_GUARD_SQL = `
  -- Upgrade: remove the previous (inverted) policy's triggers and its
  -- one-shot authorization table from databases created by earlier
  -- builds, then install the corrected policy below.
  DROP TRIGGER IF EXISTS trg_token_events_block_past_delete;
  DROP TRIGGER IF EXISTS trg_token_assignments_block_past_delete;
  DROP TRIGGER IF EXISTS trg_token_events_block_date_escape;
  DROP TABLE IF EXISTS token_delete_guard;

  -- Rule 1: a token event dated today or in the future can never be
  -- deleted — the event has not happened yet. A row without a valid
  -- date maps to '9999-12-31', which sorts after any real date, so
  -- undated rows fail closed (not deletable) as well. Events whose
  -- date is strictly in the past are the deletable ones.
  CREATE TRIGGER IF NOT EXISTS trg_token_events_block_upcoming_delete
  BEFORE DELETE ON token_events
  FOR EACH ROW
  WHEN COALESCE(OLD.event_date, '9999-12-31') >= date('now', 'localtime')
  BEGIN
    SELECT RAISE(ABORT, 'Token events whose date is not over yet cannot be deleted — wait until the event date has passed');
  END;

  -- Rule 2: tokens of an upcoming (or undated) event cannot be deleted —
  -- families hold those numbers for an event that has not happened yet.
  -- When a PAST event is deleted, the app removes its tokens explicitly
  -- inside the same audited transaction, and the FK ON DELETE CASCADE
  -- only ever fires after that same past parent row is gone, so the
  -- EXISTS probe below finds no upcoming event and never blocks the
  -- legitimate cleanup flow.
  CREATE TRIGGER IF NOT EXISTS trg_token_assignments_block_upcoming_delete
  BEFORE DELETE ON token_assignments
  FOR EACH ROW
  WHEN EXISTS (
    SELECT 1 FROM token_events e
    WHERE e.id = OLD.event_id
      AND COALESCE(e.event_date, '9999-12-31') >= date('now', 'localtime')
  )
  BEGIN
    SELECT RAISE(ABORT, 'Tokens of an event whose date is not over yet cannot be deleted');
  END;

  -- Rule 3: an upcoming event's date cannot be moved into the past —
  -- that would fake completion and bypass rule 1. Postponing a future
  -- event (future to future) and correcting a past event's date (past
  -- to past) stay allowed.
  CREATE TRIGGER IF NOT EXISTS trg_token_events_block_backdate_escape
  BEFORE UPDATE OF event_date ON token_events
  FOR EACH ROW
  WHEN COALESCE(OLD.event_date, '9999-12-31') >= date('now', 'localtime')
    AND COALESCE(NEW.event_date, '') < date('now', 'localtime')
  BEGIN
    SELECT RAISE(ABORT, 'The date of an event that has not happened yet cannot be moved into the past');
  END;
`;

/** Install the guard triggers (idempotent, safe on every boot). */
export function installTokenDateGuard(database: ExecutableDb): void {
  database.exec(TOKEN_DATE_GUARD_SQL);
}
