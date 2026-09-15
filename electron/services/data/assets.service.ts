/* Asset register module — the mahallu's buildings, lands and rentable goods,
 * each with a unique code, and the accounting link that rolls rent income and
 * repair expenses up per asset (V036). */

import { all, one, run, scalar } from "../../db/connection.js";

/** Statuses that take an asset out of circulation — hidden from the
 *  accounting "Asset" dropdown once the mahallu no longer holds it. */
const RETIRED_STATUSES = ["Sold", "Demolished", "Transferred"];

export const ASSET_CATEGORIES = [
  "Building", "Land", "Shop", "Room", "Hall", "Vehicle", "Furniture", "Equipment", "Other",
] as const;

export const ASSET_STATUSES = [
  "In use", "Given rent", "Vacant", "Under construction", "Sold", "Demolished", "Transferred",
] as const;

export const ASSET_CONDITIONS = ["Good", "Needs repair", "Dilapidated"] as const;

export const assets = {
  list: (filter: { search?: string; category?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(a.asset_code LIKE ? OR a.name LIKE ? OR a.location LIKE ? OR a.reference_no LIKE ? OR a.tenant_name LIKE ? OR a.custodian LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t, t, t);
    }
    if (filter.category && filter.category !== "All") {
      where.push("a.category = ?");
      params.push(filter.category);
    }
    if (filter.status && filter.status !== "All") {
      where.push("a.status = ?");
      params.push(filter.status);
    }
    // Per-asset ledger totals ride along with every row so the table can show
    // what each building/land/good has actually earned and cost so far.
    const ledgerTotals = `(
      SELECT COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0)
      FROM transactions t WHERE t.asset_id = a.id AND (t.status IS NULL OR t.status != 'Void')
    )`;
    const ledgerExpense = `(
      SELECT COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0)
      FROM transactions t WHERE t.asset_id = a.id AND (t.status IS NULL OR t.status != 'Void')
    )`;
    const sql = `SELECT a.*,
      ${ledgerTotals} AS income_total,
      ${ledgerExpense} AS expense_total
      FROM assets a WHERE ${where.join(" AND ")}
      ORDER BY a.asset_code ASC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const rows = all<any>(`${sql} LIMIT ? OFFSET ?`, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM assets a WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },

  get: (id: number) => one<any>("SELECT * FROM assets WHERE id = ?", [id]),

  create: (data: any) => {
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("Asset name is required");
    // Unique code with the same suffix-max scheme as receipts: a manually
    // typed high code (AST-5000) can never make a later auto number collide.
    const code = (() => {
      const rows = all<{ n: string }>("SELECT asset_code AS n FROM assets");
      let max = 0;
      for (const r of rows) { const m = /(\d+)\s*$/.exec(String(r.n ?? "")); if (m) max = Math.max(max, parseInt(m[1], 10)); }
      return `AST-${String(max + 1).padStart(3, "0")}`;
    })();
    const income = data.incomeGenerating === 0 || data.incomeGenerating === "0" ? 0 : (data.incomeGenerating ? 1 : 0);
    const { id } = run(
      `INSERT INTO assets
        (asset_code, name, category, reference_no, location, acquisition_date, acquisition_cost, current_value,
         status, condition_note, custodian, income_generating, tenant_name, monthly_rent, agreement_start, agreement_end, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, name,
        data.category || "Other",
        String(data.referenceNo ?? "").trim(),
        String(data.location ?? "").trim(),
        data.acquisitionDate || "",
        Number(data.acquisitionCost) || 0,
        Number(data.currentValue) || 0,
        data.status || "In use",
        data.conditionNote || "Good",
        String(data.custodian ?? "").trim(),
        income,
        income ? String(data.tenantName ?? "").trim() : "",
        income ? (Number(data.monthlyRent) || 0) : 0,
        income ? (data.agreementStart || "") : "",
        income ? (data.agreementEnd || "") : "",
        String(data.notes ?? "").trim(),
      ]
    );
    return { id, assetCode: code };
  },

  update: (id: number, data: any) => {
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("Asset name is required");
    const income = data.incomeGenerating === 0 || data.incomeGenerating === "0" ? 0 : (data.incomeGenerating ? 1 : 0);
    return run(
      `UPDATE assets SET name = ?, category = ?, reference_no = ?, location = ?, acquisition_date = ?,
        acquisition_cost = ?, current_value = ?, status = ?, condition_note = ?, custodian = ?,
        income_generating = ?, tenant_name = ?, monthly_rent = ?, agreement_start = ?, agreement_end = ?,
        notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        name,
        data.category || "Other",
        String(data.referenceNo ?? "").trim(),
        String(data.location ?? "").trim(),
        data.acquisitionDate || "",
        Number(data.acquisitionCost) || 0,
        Number(data.currentValue) || 0,
        data.status || "In use",
        data.conditionNote || "Good",
        String(data.custodian ?? "").trim(),
        income,
        income ? String(data.tenantName ?? "").trim() : "",
        income ? (Number(data.monthlyRent) || 0) : 0,
        income ? (data.agreementStart || "") : "",
        income ? (data.agreementEnd || "") : "",
        String(data.notes ?? "").trim(),
        id
      ]
    );
  },

  /** An asset that already carries ledger entries must not be deleted — that
   *  would orphan the rent/repair trail. Retire it (status Sold/Demolished)
   *  instead; a truly mistyped asset with no entries deletes freely. */
  remove: (id: number) => {
    const tagged = one<{ c: number }>("SELECT COUNT(*) AS c FROM transactions WHERE asset_id = ?", [id])?.c ?? 0;
    if (tagged > 0) {
      throw new Error("This asset has accounting entries linked to it, so it cannot be deleted. Change its status to Sold or Demolished instead.");
    }
    return run("DELETE FROM assets WHERE id = ?", [id]);
  },

  /** Active assets for the accounting "Asset" dropdown (retired ones hidden). */
  options: () => all<any>(
    `SELECT id, asset_code, name, category, income_generating, monthly_rent FROM assets
     WHERE status NOT IN ('Sold', 'Demolished', 'Transferred')
     ORDER BY name ASC`
  ),

  /** Page-level numbers for the Assets dashboard cards. */
  summary: () => {
    const row = one<any>(
      `SELECT COUNT(*) AS count,
        COALESCE(SUM(income_generating), 0) AS income_generating,
        COALESCE(SUM(CASE WHEN income_generating = 1 THEN monthly_rent ELSE 0 END), 0) AS monthly_rent_potential,
        COALESCE(SUM(current_value), 0) AS total_current_value
       FROM assets`
    );
    const byCategory = all<any>(
      `SELECT category, COUNT(*) AS count, COALESCE(SUM(current_value), 0) AS value
       FROM assets GROUP BY category ORDER BY count DESC, category ASC`
    );
    return {
      count: row?.count ?? 0,
      incomeGenerating: row?.income_generating ?? 0,
      monthlyRentPotential: row?.monthly_rent_potential ?? 0,
      totalCurrentValue: row?.total_current_value ?? 0,
      byCategory,
    };
  },

  /** Everything the ledger knows about one asset — its income/expense story. */
  statement: (assetId: number) => {
    const totals = one<any>(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions WHERE asset_id = ? AND (status IS NULL OR status != 'Void')`,
      [assetId]
    );
    const entries = all<any>(
      `SELECT t.id, t.txn_date, t.type, t.amount, t.description, t.category, t.receipt_number, t.status
       FROM transactions t WHERE t.asset_id = ?
       ORDER BY t.txn_date DESC, t.id DESC LIMIT 50`,
      [assetId]
    );
    const income = totals?.income ?? 0;
    const expense = totals?.expense ?? 0;
    return { income, expense, net: income - expense, entries };
  },

  /** Keeps the retired-status list importable for tests/tools. */
  RETIRED_STATUSES,
};
