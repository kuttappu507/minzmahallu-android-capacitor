/*
 * V038 — ledger categories + edit/void re-authentication support columns.
 *
 * Manual income/expense entries can carry a category (Shop Rent, Goods Rent,
 * Hall Rent …) for masjids with rental income. The category must:
 *   - persist on the transactions row (idempotent column migration),
 *   - flow through the 19-column unified UNION unchanged,
 *   - be searchable from the ledger search box,
 *   - survive edits.
 * The SECURITY side (administrator password + reason required for edit/void)
 * is enforced in security-ipc.ts — the IPC layer — and cannot be exercised
 * from a plain service test; here we pin the service layer it protects.
 */
import { describe, it, expect } from "vitest";
import { getDB } from "../db/connection.js";
import { accounting } from "./data/accounting.service.js";

describe("ledger categories (V038)", () => {
  it("has the category column after the runtime schema migration", () => {
    const cols = getDB().prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("category");
  });

  it("stores a rental category and projects it through the unified ledger", () => {
    const res = accounting.create({
      txnDate: "2025-04-10", type: "Income", amount: 5000, paymentMethod: "UPI",
      description: "Shop 1 monthly rent", category: "Shop Rent", createdBy: 1,
    });
    expect(res.id).toBeGreaterThan(0);

    const row = accounting.get(res.id) as any;
    expect(row.category).toBe("Shop Rent");

    // The unified UNION must stay uniform: category present on the manual row,
    // NULL on auto rows, and every source still projecting the same shape.
    const uni = accounting.unifiedList({ period: "all" }) as any;
    const mine = (uni.rows || []).find((r: any) => r.source === "transactions" && r.source_id === res.id);
    expect(mine?.category).toBe("Shop Rent");
    const donationRow = (uni.rows || []).find((r: any) => r.source === "donations");
    if (donationRow) expect(donationRow.category ?? null).toBeNull();
  });

  it("finds entries by category search", () => {
    const uni = accounting.unifiedList({ period: "all", search: "Shop Rent" }) as any;
    expect((uni.rows || []).some((r: any) => r.category === "Shop Rent")).toBe(true);
  });

  it("rewrites the category on update without breaking other fields", () => {
    const res = accounting.create({
      txnDate: "2025-04-11", type: "Income", amount: 1200, paymentMethod: "Cash",
      description: "Shop 2 monthly rent", category: "Shop Rent", createdBy: 1,
    });
    accounting.update(res.id, {
      txnDate: "2025-04-11", accountId: 1, type: "Income", amount: 1200, paymentMethod: "Cash",
      description: "Shop 2 monthly rent", category: "Goods Rent",
      linkedModule: "", linkedId: null, transactionRef: "",
    });
    const row = accounting.get(res.id) as any;
    expect(row.category).toBe("Goods Rent");
    expect(row.description).toBe("Shop 2 monthly rent");
    expect(row.amount).toBe(1200);
  });
});
