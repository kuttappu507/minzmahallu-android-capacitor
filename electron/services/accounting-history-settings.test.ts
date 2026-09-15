/*
 * Regression tests for the accounting preview + settings wiring batch:
 *
 *  1. DOUBLE-CLICK PREVIEW — accounting.unifiedDetail() must return the full
 *     underlying record plus the change history (record_history diffs and the
 *     audit trail) for a ledger row, and unifiedList must flag rows that were
 *     edited (has_history) so the UI can badge them "EDITED".
 *
 *  2. SUBSCRIPTION FREQUENCY — Settings → subscription_frequency must actually
 *     drive the recurring billing period (monthly vs calendar-quarter) and the
 *     plan selection. Previously the column existed but the engine always ran
 *     monthly and settings.save never wrote the column.
 *
 *  3. FINANCIAL YEAR START — the annual audit pack must honour the configured
 *     financial_year_start (MM-DD) instead of hardcoding 01-Apr → 31-Mar.
 *
 * The SECURITY side of ledger edits (administrator password + reason) lives in
 * security-ipc.ts and cannot be exercised from a plain service test; the
 * record_history rows it writes are simulated here with direct inserts.
 */
import { describe, it, expect } from "vitest";
import { getDB } from "../db/connection.js";
import { accounting } from "./data/accounting.service.js";
import { settings } from "./data/settings.service.js";
import { subscriptions } from "./data/subscriptions.service.js";
import { families } from "./data.service.js";

describe("accounting preview + edit flag", () => {
  it("unifiedDetail returns the record and unifiedList starts with a clean history", () => {
    const res = accounting.create({
      txnDate: "2025-04-10", type: "Income", amount: 5000, paymentMethod: "UPI",
      description: "Hall rent", category: "Hall Rent", createdBy: 1,
    });
    expect(res.id).toBeGreaterThan(0);

    const detail = accounting.unifiedDetail("transactions", res.id) as any;
    expect(detail.record).toBeTruthy();
    expect(detail.record.description).toBe("Hall rent");
    expect(detail.record.category).toBe("Hall Rent");
    expect(detail.changes).toEqual([]);
    expect(detail.auditTrail).toEqual([]);

    const uni = accounting.unifiedList({ period: "all", source: "transactions" }) as any;
    const mine = (uni.rows || []).find((r: any) => r.source_id === res.id);
    expect(mine?.has_history ?? 0).toBe(0);
  });

  it("flags the row as edited and surfaces the diff once a change history exists", () => {
    const res = accounting.create({
      txnDate: "2025-04-12", type: "Expense", amount: 900, paymentMethod: "Cash",
      description: "Shop rent bookkeeping", category: "Shop Rent", createdBy: 1,
    });
    // Simulate exactly what security-ipc.ts writes after an authenticated edit:
    // a record_history EDIT row with a structured before→after diff…
    getDB().prepare(
      `INSERT INTO record_history (entity_type, entity_id, action, user_id, username, summary, changes_json, reason)
       VALUES ('transaction', ?, 'EDIT', 1, 'admin', 'Ledger entry edited', ?, 'wrong amount entered')`
    ).run(res.id, JSON.stringify({ amount: { old: 900, new: 1200 } }));
    // …and an audit_log UPDATE row carrying the same diff in metadata.
    getDB().prepare(
      `INSERT INTO audit_log (user_id, username, action, module, entity_id, description, metadata, created_at)
       VALUES (1, 'admin', 'UPDATE', 'accounting', ?, 'Ledger entry edited after administrator re-authentication: wrong amount entered', ?, datetime('now'))`
    ).run(res.id, JSON.stringify({ amount: { old: 900, new: 1200 } }));

    const detail = accounting.unifiedDetail("transactions", res.id) as any;
    expect(detail.changes.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(detail.changes[0].changes_json);
    expect(parsed.amount).toEqual({ old: 900, new: 1200 });
    expect(detail.auditTrail.length).toBeGreaterThanOrEqual(1);

    const uni = accounting.unifiedList({ period: "all", source: "transactions" }) as any;
    const mine = (uni.rows || []).find((r: any) => r.source_id === res.id);
    expect(mine?.has_history).toBe(1);
  });
});

describe("subscription frequency setting is wired", () => {
  it("settings.save persists subscription_frequency and backup_keep_count", () => {
    settings.save({ subscriptionFrequency: "Quarterly", backupKeepCount: 12 });
    const row = getDB().prepare("SELECT subscription_frequency, backup_keep_count FROM settings WHERE id = 1").get() as any;
    expect(row.subscription_frequency).toBe("Quarterly");
    expect(row.backup_keep_count).toBe(12);
    // And back — the value must round-trip both ways.
    settings.save({ subscriptionFrequency: "Monthly", backupKeepCount: 30 });
    const row2 = getDB().prepare("SELECT subscription_frequency, backup_keep_count FROM settings WHERE id = 1").get() as any;
    expect(row2.subscription_frequency).toBe("Monthly");
    expect(row2.backup_keep_count).toBe(30);
  });

  it("ensureCurrentMonth creates QUARTER accounts when frequency is Quarterly", () => {
    // The engine needs a rate to operate. Databases created before the schema
    // fix have no Quarterly plan row (old CHECK constraint silently swallowed
    // V021's seed) — the engine falls back to the Monthly plan row while still
    // billing the real quarter period, so the test must not depend on which
    // plan row is attached.
    // Fresh DBs ship empty: give the engine a family WITHOUT an account so it
    // actually creates one (other suites' families already have accounts).
    families.create({ houseName: "Quarterly Engine Fixture", phone: "919876543210", whatsappPhone: "919876543210", whatsappEnabled: 1 });
    getDB().prepare("UPDATE settings SET subscription_monthly_amount = 450, subscription_frequency = 'Quarterly' WHERE id = 1").run();

    const before = getDB().prepare("SELECT COUNT(*) AS c FROM subscriptions").get() as any;
    const res = subscriptions.ensureCurrentMonth() as any;
    const after = getDB().prepare("SELECT COUNT(*) AS c FROM subscriptions").get() as any;

    // Whatever the engine did (create or roll over), the resulting accounts
    // must carry a true QUARTER period and the configured quarterly rate.
    expect(res.periodStart).toMatch(/-\d{2}-01$/);
    const spanDaysRes = (new Date(res.periodEnd).getTime() - new Date(res.periodStart).getTime()) / 86400000;
    expect(spanDaysRes).toBeGreaterThan(88); // ~90 days, never a month (~30)
    expect(res.amount).toBe(450);
    expect(after.c).toBeGreaterThanOrEqual(before.c);

    const acct = getDB().prepare(
      "SELECT period_start, period_end, amount FROM subscriptions ORDER BY id DESC LIMIT 1"
    ).get() as any;
    const spanDays = (new Date(acct.period_end).getTime() - new Date(acct.period_start).getTime()) / 86400000;
    expect(spanDays).toBeGreaterThan(88);
    expect(acct.amount).toBe(450);

    getDB().prepare("UPDATE settings SET subscription_frequency = 'Monthly' WHERE id = 1").run();
  });
});

describe("audit pack honours the financial year start setting", () => {
  it("uses the configured MM-DD boundary instead of hardcoded 04-01", () => {
    // Two income entries straddling the Kerala default FY 2025-26.
    accounting.create({ txnDate: "2025-03-31", type: "Income", amount: 1000, paymentMethod: "Cash", description: "FY2024 closing", createdBy: 1 });
    accounting.create({ txnDate: "2025-04-01", type: "Income", amount: 2000, paymentMethod: "Cash", description: "FY2025 opening", createdBy: 1 });

    // Default 04-01 → FY2025 covers 2025-04-01 .. 2026-03-31: only the ₹2000 entry.
    settings.save({ financialYearStart: "04-01" });
    const packDefault = accounting.auditPack(2025) as any;
    expect(packDefault.fyLabel).toBe("2025-04-01 to 2026-03-31");
    const manualDefault = (packDefault.transactions as any[]).filter((t) => t.description === "FY2025 opening");
    expect(manualDefault.length).toBe(1);
    expect((packDefault.transactions as any[]).some((t) => t.description === "FY2024 closing")).toBe(false);

    // A masjid whose books close on 01-Jan → FY2025 covers 2025-01-01 .. 2025-12-31:
    // BOTH entries now fall inside the same year.
    settings.save({ financialYearStart: "01-01" });
    const packJan = accounting.auditPack(2025) as any;
    expect(packJan.fyLabel).toBe("2025-01-01 to 2025-12-31");
    expect((packJan.transactions as any[]).some((t) => t.description === "FY2024 closing")).toBe(true);
    expect((packJan.transactions as any[]).some((t) => t.description === "FY2025 opening")).toBe(true);

    settings.save({ financialYearStart: "04-01" });
  });
});
