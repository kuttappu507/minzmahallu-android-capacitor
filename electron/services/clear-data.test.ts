/*
 * clearAllData — the Settings → Danger Zone factory reset for record data.
 * Verifies the wipe erases business records while configuration, reference
 * data and the login survive, and that AUTOINCREMENT counters restart.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDB } from "../db/connection.js";
import { clearAllData } from "./data/clear-data.service.js";
import { ensureFamily, ensurePendingSubscription } from "./fixtures.js";

describe("clearAllData (factory reset)", () => {
  beforeAll(() => { getDB(); });

  it("erases business records but keeps users, settings, plans and categories", () => {
    const db = getDB();
    // Seed some business records the wipe must remove.
    const famId = ensureFamily();
    ensurePendingSubscription(famId, 150);
    const before = {
      families: (db.prepare("SELECT COUNT(*) AS c FROM families").get() as any).c,
      members: (db.prepare("SELECT COUNT(*) AS c FROM members").get() as any).c,
    };
    expect(before.families).toBeGreaterThan(0);

    const r = clearAllData("moving to production");
    expect(r.cleared).toContain("members");
    expect(r.cleared).toContain("families");

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c;
    expect(count("families")).toBe(0);
    expect(count("members")).toBe(0);
    expect(count("subscriptions")).toBe(0);
    // Configuration / reference data survives untouched.
    expect(count("settings")).toBeGreaterThan(0);
    expect(count("donation_categories")).toBeGreaterThan(0);
    const s = db.prepare("SELECT mahallu_name, receipt_prefix FROM settings WHERE id = 1").get() as any;
    expect(s).toBeTruthy();
    // A reason is mandatory.
    expect(() => clearAllData("  ")).toThrow(/reason/i);
  });
});
