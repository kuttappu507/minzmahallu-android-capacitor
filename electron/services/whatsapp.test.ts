import { describe, it, expect, beforeAll } from "vitest";
import { whatsapp } from "./whatsapp.service.js";
import { recipientStats } from "./whatsapp-recipient.service.js";
import { getDB } from "../db/connection.js";
import { ensureFamily, ensurePendingSubscription } from "./fixtures.js";

describe("whatsapp service schema & phone handling", () => {
  beforeAll(() => {
    whatsapp.init();
  });

  it("creates the whatsapp tables and a single settings row", () => {
    const db = getDB();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'whatsapp%'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tables).toEqual([
      "whatsapp_campaign_recipients",
      "whatsapp_campaigns",
      "whatsapp_messages",
      "whatsapp_settings",
    ]);
    const row = db.prepare("SELECT id, session_name, status FROM whatsapp_settings WHERE id=1").get() as any;
    expect(row).toBeTruthy();
    expect(row.session_name).toBe("mahallu");
  });

  it("normalizes phone input to bare digits with sane length bounds", () => {
    expect(whatsapp.normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(whatsapp.normalizePhone("(080) 234-5678")).toBe("0802345678");
    expect(whatsapp.normalizePhone("")).toBe("");
    expect(whatsapp.normalizePhone("12345")).toBe(""); // too short
  });

  it("persists family WhatsApp preferences with validation", () => {
    const famId = ensureFamily(1);
    const result = whatsapp.setFamilyWhatsApp(famId, "9876543210", true);
    expect(result.changes).toBe(1);
    const fam = whatsapp.familyWhatsApp(famId) as any;
    expect(fam.whatsapp_phone).toBe("9876543210");
    expect(fam.whatsapp_enabled).toBe(1);
    expect(() => whatsapp.setFamilyWhatsApp(famId, "12", true)).toThrow("valid WhatsApp number");
  });
});

describe("whatsapp campaign guards (anti-double-send)", () => {
  beforeAll(() => {
    whatsapp.init();
    const db = getDB();
    // Fresh DBs ship EMPTY (no demo dataset): make sure family 1 exists with
    // a pending subscription so the reminder has an eligible recipient.
    const famId = ensureFamily(1);
    ensurePendingSubscription(famId, 100);
    whatsapp.setFamilyWhatsApp(famId, "919876543210", true);
    db.prepare(
      "UPDATE subscriptions SET amount=100, amount_paid=0, status='Pending' WHERE family_id=? AND id=(SELECT id FROM subscriptions WHERE family_id=? LIMIT 1)"
    ).run(famId, famId);
  });

  it("reports recipient readiness stats", () => {
    const stats = recipientStats("SUBSCRIPTION_REMINDER") as any;
    expect(stats.type).toBe("SUBSCRIPTION_REMINDER");
    expect(stats.activeFamilies).toBeGreaterThan(0);
    expect(typeof stats.eligible).toBe("number");
    expect(typeof stats.missingWhatsApp).toBe("number");
    expect(stats.willSend).toBeGreaterThanOrEqual(0);
  });

  it("creates a subscription reminder campaign and blocks a duplicate for the same month", async () => {
    const c = await whatsapp.createSubscriptionCampaign();
    expect(c.campaignId).toBeGreaterThan(0);
    expect(c.total).toBeGreaterThan(0);
    await expect(whatsapp.createSubscriptionCampaign()).rejects.toThrow(/already been started/);
  });

  it("creates one announcement per day and blocks a second", async () => {
    const a = await whatsapp.createAnnouncementCampaign("Test announcement");
    expect(a.campaignId).toBeGreaterThan(0);
    expect(a.total).toBeGreaterThan(0);
    await expect(whatsapp.createAnnouncementCampaign("Another")).rejects.toThrow(/already been started/);
  });
});
