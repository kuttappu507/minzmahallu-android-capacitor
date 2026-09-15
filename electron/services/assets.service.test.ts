/*
 * Asset register (V036) — buildings, lands and rentable goods + the
 * accounting link. Pinned here:
 *   - idempotent runtime schema (assets table + transactions.asset_id),
 *   - unique AST-### codes that survive manual high codes,
 *   - the accounting link: rent income / repair expenses tagged with the
 *     asset roll up per asset, unknown ids are refused,
 *   - delete protection for assets that already carry ledger entries,
 *   - the dropdown hides retired assets,
 *   - the unified ledger keeps its uniform shape (asset_name on manual rows,
 *     NULL everywhere else).
 */
import { describe, it, expect } from "vitest";
import { getDB } from "../db/connection.js";
import { assets, accounting } from "./data.service.js";

describe("asset register schema (V036)", () => {
  it("creates the assets table and the transactions.asset_id link", () => {
    const db = getDB();
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((t) => t.name));
    expect(tables.has("assets")).toBe(true);
    const cols = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("asset_id");
  });
});

describe("asset CRUD + codes", () => {
  it("auto-generates sequential AST- codes", () => {
    const a = assets.create({ name: "Test Shop A", category: "Shop", currentValue: 100 });
    const b = assets.create({ name: "Test Shop B", category: "Building", currentValue: 200 });
    expect(a.assetCode).toMatch(/^AST-\d{3,}$/);
    expect(b.assetCode).toMatch(/^AST-\d{3,}$/);
    expect(Number(b.assetCode.replace("AST-", ""))).toBe(Number(a.assetCode.replace("AST-", "")) + 1);
    assets.remove(a.id);
    assets.remove(b.id);
  });

  it("a manually typed high code never breaks the auto numbering", () => {
    // Same suffix-max scheme as receipt numbers: MAX(suffix)+1, not id+1.
    const high = assets.create({ name: "Manual High Asset", currentValue: 0 });
    getDB().prepare("UPDATE assets SET asset_code = ? WHERE id = ?").run("AST-9000", high.id);
    const next = assets.create({ name: "After High Asset", currentValue: 0 });
    expect(next.assetCode).toBe("AST-9001");
    assets.remove(high.id);
    assets.remove(next.id);
  });

  it("refuses to save an asset without a name", () => {
    expect(() => assets.create({ name: "   ", category: "Land" })).toThrow(/name/i);
  });

  it("clears tenant fields when the asset is not income-generating", () => {
    const a = assets.create({
      name: "Non-income Hall", category: "Hall", incomeGenerating: 0,
      tenantName: "Ghost Tenant", monthlyRent: 999, agreementStart: "2026-01-01",
    });
    const row = assets.get(a.id) as any;
    expect(row.income_generating).toBe(0);
    expect(row.tenant_name).toBe("");
    expect(row.monthly_rent).toBe(0);
    assets.remove(a.id);
  });

  it("updates persist every field", () => {
    const a = assets.create({ name: "Update Me", category: "Land", currentValue: 10 });
    assets.update(a.id, {
      name: "Updated Plot", category: "Land", referenceNo: "Sy.No. 5/1", location: "East",
      acquisitionDate: "2020-05-05", acquisitionCost: 1000, currentValue: 2000,
      status: "Given rent", conditionNote: "Needs repair", custodian: "Treasurer",
      incomeGenerating: 1, tenantName: "Kunjabdulla", monthlyRent: 500,
      agreementStart: "2026-01-01", agreementEnd: "2027-01-01", notes: "note",
    });
    const row = assets.get(a.id) as any;
    expect(row.name).toBe("Updated Plot");
    expect(row.reference_no).toBe("Sy.No. 5/1");
    expect(row.status).toBe("Given rent");
    expect(row.income_generating).toBe(1);
    expect(row.tenant_name).toBe("Kunjabdulla");
    expect(row.monthly_rent).toBe(500);
    assets.remove(a.id);
  });
});

describe("asset <-> accounting link", () => {
  it("tags a rent income entry and rolls the totals up per asset", () => {
    const a = assets.create({ name: "Ledger Link Shop", category: "Shop", incomeGenerating: 1, monthlyRent: 1000 });
    const income = accounting.create({
      txnDate: "2026-08-01", type: "Income", amount: 6500, description: "Shop rent — Aug",
      category: "Shop Rent", assetId: a.id, createdBy: 1,
    });
    const st1 = assets.statement(a.id) as any;
    expect(st1.income).toBe(6500);
    expect(st1.net).toBe(6500);
    expect(st1.entries.some((e: any) => e.id === income.id && e.category === "Shop Rent")).toBe(true);

    // Repair expense on the same asset reduces the net.
    accounting.create({
      txnDate: "2026-08-15", type: "Expense", amount: 1200, description: "Shutter repair",
      category: "Maintenance", assetId: a.id, createdBy: 1,
    });
    const st2 = assets.statement(a.id) as any;
    expect(st2.expense).toBe(1200);
    expect(st2.net).toBe(5300);

    // The ledger list joins the asset name through.
    const listed = accounting.list({ search: "Shutter repair" }) as any;
    expect(listed.rows[0]?.asset_name).toBe("Ledger Link Shop");
    // Deliberately NOT removed — it now carries ledger entries (delete
    // protection is pinned in the next test).
  });

  it("refuses to delete an asset that carries ledger entries", () => {
    const a = assets.create({ name: "Protected Asset", category: "Building" });
    accounting.create({ txnDate: "2026-08-02", type: "Income", amount: 100, description: "x", assetId: a.id, createdBy: 1 });
    expect(() => assets.remove(a.id)).toThrow(/cannot be deleted/i);
  });

  it("refuses an unknown asset id instead of dropping the link silently", () => {
    expect(() => accounting.create({
      txnDate: "2026-08-03", type: "Income", amount: 10, description: "ghost", assetId: 999999, createdBy: 1,
    })).toThrow(/no longer exists/i);
    expect(() => accounting.update(1, { txnDate: "2026-08-03", type: "Income", amount: 10, description: "ghost", assetId: 999999 })).toThrow(/no longer exists/i);
  });

  it("keeps the unified ledger shape uniform (asset_name only on manual rows)", () => {
    const uni = accounting.unifiedList({ period: "all" }) as any;
    const manual = (uni.rows || []).find((r: any) => r.source === "transactions");
    expect(manual).toBeTruthy();
    expect("asset_name" in manual).toBe(true);
    for (const other of ["donations", "subscriptions", "welfare", "salary"]) {
      const row = (uni.rows || []).find((r: any) => r.source === other);
      if (row) expect(row.asset_name ?? null).toBeNull();
    }
  });
});

describe("asset options + summary", () => {
  it("hides retired assets from the accounting dropdown", () => {
    const live = assets.create({ name: "Live Option Asset", category: "Room" });
    const sold = assets.create({ name: "Sold Option Asset", category: "Room", status: "Sold" });
    const opts = assets.options() as any[];
    expect(opts.some((o) => o.id === live.id)).toBe(true);
    expect(opts.some((o) => o.id === sold.id)).toBe(false);
    assets.remove(live.id);
    assets.remove(sold.id);
  });

  it("summary counts income-generating assets and rent potential", () => {
    const a = assets.create({ name: "Summary Shop", category: "Shop", currentValue: 5000, incomeGenerating: 1, monthlyRent: 3000 });
    const s = assets.summary() as any;
    expect(s.count).toBeGreaterThanOrEqual(1);
    expect(s.incomeGenerating).toBeGreaterThanOrEqual(1);
    expect(s.monthlyRentPotential).toBeGreaterThanOrEqual(3000);
    expect(s.totalCurrentValue).toBeGreaterThanOrEqual(5000);
    assets.remove(a.id);
  });
});
