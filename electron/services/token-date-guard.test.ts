/*
 * Date-based token-event deletion policy (see db/token-guard.ts).
 *
 * Policy under test, enforced at THREE layers:
 *   1. data.tokens.removeEvent / updateEvent (friendly service errors)
 *   2. DB triggers (backstop that blocks even an external SQLite editor)
 *   3. the upgrade path: databases created by earlier builds carry the
 *      previous (inverted) policy's triggers and token_delete_guard
 *      table — installTokenDateGuard must remove them.
 *
 * Event dates are seeded relative to today so the suite never goes stale:
 * istPlusDays(-30) is safely "over" in both IST and the test machine's
 * local timezone, and istPlusDays(+7) is safely "upcoming".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDB } from "../db/connection.js";
import { tokens, families } from "./data.service.js";
import { todayIST, istPlusDays } from "./ist-date.js";
import { installTokenDateGuard } from "../db/token-guard.js";

const ACTOR = { id: 1, username: "vitest" };

function makeEvent(name: string, date: string) {
  return tokens.createEvent({
    eventName: name, eventType: "general", eventDate: date,
    eventTime: "10:00", venue: "Test Hall", description: "",
  });
}

let familyId = 0;

beforeAll(() => {
  getDB(); // schema + migrations + token date-guard triggers (throwaway DB)
  const fam = families.create({ houseName: "Token Date Guard Test Family" });
  familyId = Number(fam.id);
});

describe("token events — deletion is allowed once the date is over (service layer)", () => {
  it("a past event with tokens is deleted (tokens cascade) and audited", () => {
    const ev = makeEvent("Guard Past Event", istPlusDays(-30));
    tokens.generate(ev.id, [familyId], ACTOR.id);
    const result = tokens.removeEvent(ev.id, "event is over, no need to keep (test)", ACTOR) as any;
    expect(result.success).toBe(true);
    expect(result.deletedTokens).toBe(1);
    expect(tokens.getEvent(ev.id)).toBeUndefined();
    expect(getDB().prepare("SELECT COUNT(*) AS c FROM token_assignments WHERE event_id = ?").get(ev.id)).toMatchObject({ c: 0 });
    const auditRow = getDB()
      .prepare("SELECT id FROM audit_log WHERE module = 'token_events' AND entity_id = ? AND action = 'DELETE'")
      .get(ev.id);
    expect(auditRow).toBeTruthy();
  });

  it("an event dated TODAY is refused (the date must be strictly over)", () => {
    const ev = makeEvent("Guard Today Event", todayIST());
    expect(() => tokens.removeEvent(ev.id, "boundary check (test)", ACTOR)).toThrow(/not yet passed/);
    expect(tokens.getEvent(ev.id)).toBeTruthy();
  });

  it("a future event is refused with the friendly 'not yet passed' error", () => {
    const ev = makeEvent("Guard Future Event", istPlusDays(7));
    expect(() => tokens.removeEvent(ev.id, "cleanup attempt (test)", ACTOR)).toThrow(/not yet passed/);
    expect(tokens.getEvent(ev.id)).toBeTruthy();
  });

  it("a missing reason is refused even for a past event", () => {
    const ev = makeEvent("Guard No-Reason Event", istPlusDays(-30));
    expect(() => tokens.removeEvent(ev.id, "   ", ACTOR)).toThrow(/reason is required/);
  });
});

describe("token events — upcoming events are protected (DB triggers)", () => {
  it("a raw DELETE on a future event is blocked by the trigger", () => {
    const ev = makeEvent("Guard Raw Delete Event", istPlusDays(15));
    expect(() => getDB().prepare("DELETE FROM token_events WHERE id = ?").run(ev.id)).toThrow(/cannot be deleted/);
    expect(tokens.getEvent(ev.id)).toBeTruthy();
  });

  it("a raw DELETE on an event dated TODAY is blocked by the trigger", () => {
    const ev = makeEvent("Guard Raw Today Event", todayIST());
    expect(() => getDB().prepare("DELETE FROM token_events WHERE id = ?").run(ev.id)).toThrow(/cannot be deleted/);
    expect(tokens.getEvent(ev.id)).toBeTruthy();
  });

  it("a raw DELETE of an upcoming event's token is blocked", () => {
    const ev = makeEvent("Guard Raw Token Event", istPlusDays(10));
    tokens.generate(ev.id, [familyId], ACTOR.id);
    const tok = getDB().prepare("SELECT id FROM token_assignments WHERE event_id = ?").get(ev.id) as { id: number };
    expect(() => getDB().prepare("DELETE FROM token_assignments WHERE id = ?").run(tok.id)).toThrow(/cannot be deleted/);
    expect(getDB().prepare("SELECT COUNT(*) AS c FROM token_assignments WHERE id = ?").get(tok.id)).toMatchObject({ c: 1 });
  });

  it("a raw DELETE of a past event's token is allowed (the record is spent once the event is over)", () => {
    const ev = makeEvent("Guard Spent Token Event", istPlusDays(-10));
    tokens.generate(ev.id, [familyId], ACTOR.id);
    const tok = getDB().prepare("SELECT id FROM token_assignments WHERE event_id = ?").get(ev.id) as { id: number };
    expect(() => getDB().prepare("DELETE FROM token_assignments WHERE id = ?").run(tok.id)).not.toThrow();
    expect(getDB().prepare("SELECT COUNT(*) AS c FROM token_assignments WHERE id = ?").get(tok.id)).toMatchObject({ c: 0 });
  });

  it("installTokenDateGuard is idempotent (re-running never throws)", () => {
    expect(() => installTokenDateGuard(getDB() as any)).not.toThrow();
  });
});

describe("token events — upgrading an old database flips the policy", () => {
  it("the previous policy's triggers and guard table are removed on re-install", () => {
    const db = getDB();
    // Recreate the artifacts earlier builds left behind (inverted policy:
    // past events locked, token_delete_guard one-shot authorization).
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_delete_guard (
        key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TRIGGER trg_token_events_block_past_delete
      BEFORE DELETE ON token_events FOR EACH ROW
      WHEN OLD.event_date < date('now', 'localtime')
      BEGIN SELECT RAISE(ABORT, 'old policy'); END;
    `);
    // Re-running the installer must clean the old artifacts up and
    // reinstall the corrected policy.
    expect(() => installTokenDateGuard(db as any)).not.toThrow();
    const names = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')"
    ).all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain("token_delete_guard");
    expect(names).not.toContain("trg_token_events_block_past_delete");
    expect(names).toContain("trg_token_events_block_upcoming_delete");
    expect(names).toContain("trg_token_assignments_block_upcoming_delete");
    expect(names).toContain("trg_token_events_block_backdate_escape");
  });
});

describe("token events — the backdate escape route is closed", () => {
  it("updateEvent refuses to move a future event's date into the past", () => {
    const ev = makeEvent("Guard Escape Event", istPlusDays(20));
    expect(() =>
      tokens.updateEvent(ev.id, {
        eventName: "Guard Escape Event", eventType: "general", eventDate: istPlusDays(-5),
        eventTime: "10:00", venue: "Test Hall", description: "",
      })
    ).toThrow(/not yet passed/);
  });

  it("the DB trigger blocks the same move even for a raw UPDATE", () => {
    const ev = makeEvent("Guard Escape Raw Event", istPlusDays(20));
    expect(() =>
      getDB().prepare("UPDATE token_events SET event_date = ? WHERE id = ?").run(istPlusDays(-1), ev.id)
    ).toThrow(/cannot be moved into the past/);
    expect((tokens.getEvent(ev.id) as any).event_date).toBe(istPlusDays(20));
  });

  it("past-to-past date corrections stay allowed", () => {
    const ev = makeEvent("Guard Correction Event", istPlusDays(-20));
    expect(() =>
      tokens.updateEvent(ev.id, {
        eventName: "Guard Correction Event", eventType: "general", eventDate: istPlusDays(-21),
        eventTime: "11:00", venue: "Corrected Hall", description: "",
      })
    ).not.toThrow();
    expect((tokens.getEvent(ev.id) as any).event_date).toBe(istPlusDays(-21));
  });

  it("a future event can still be edited and postponed", () => {
    const ev = makeEvent("Guard Postpone Event", istPlusDays(3));
    expect(() =>
      tokens.updateEvent(ev.id, {
        eventName: "Guard Postpone Event", eventType: "eid", eventDate: istPlusDays(10),
        eventTime: "09:00", venue: "Bigger Hall", description: "postponed",
      })
    ).not.toThrow();
    expect((tokens.getEvent(ev.id) as any).event_date).toBe(istPlusDays(10));
  });
});
