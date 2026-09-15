/* Accounting module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run, scalar } from "../../db/connection.js";
import { donations } from "./donations.service.js";
import { settings } from "./settings.service.js";
import { nowDate } from "./shared.js";
import { subscriptions } from "./subscriptions.service.js";
import { welfare } from "./welfare.service.js";

export const accounting = {
  list: (filter: { search?: string; type?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["(t.status IS NULL OR t.status != 'Void')"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(t.description LIKE ? OR t.receipt_number LIKE ? OR t.transaction_ref LIKE ? OR t.voucher_no LIKE ? OR t.bill_no LIKE ? OR t.payee LIKE ? OR t.category LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t, t, t, t);
    }
    if (filter.type && filter.type !== "All") {
      where.push("t.type = ?");
      params.push(filter.type);
    }
    const sql = `SELECT t.*, u.username AS created_by_name, a.name AS asset_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN assets a ON a.id = t.asset_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.txn_date DESC, t.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM transactions t WHERE ${where.join(" AND ")}`,
        params
      );
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM transactions WHERE id = ?", [id]),
  create: (data: any) => {
    // Receipt numbers must NEVER be reused. MAX(id)+1 breaks if an operator
    // types a high manual receipt number (a later auto number would collide).
    // Use the same suffix-max scheme as the official registers instead.
    const receipt = data.receiptNumber || (() => {
      const rows = all<{ n: string }>("SELECT receipt_number AS n FROM transactions");
      let max = 0;
      for (const r of rows) { const m = /(\d+)\s*$/.exec(String(r.n ?? "")); if (m) max = Math.max(max, parseInt(m[1], 10)); }
      return `TXN-${String(max + 1).padStart(4, "0")}`;
    })();
    // Voucher control: auto-fill a sequential voucher number when the operator
    // didn't type one, so every expense can be traced to a voucher reference.
    const year = new Date().getFullYear();
    const voucher = data.voucherNo || scalar<string>(
      "SELECT 'VOU-' || ? || '-' || printf('%04d', COALESCE(MAX(id), 0) + 1) AS n FROM transactions",
      [String(year)]
    );
    // Duplicate bill detection: warn (don't block) when the same bill number was
    // already entered for another expense — a classic duplicate-payment red flag.
    let duplicateBill: { id: number; txn_date: string; description: string; amount: number } | null = null;
    if (data.billNo && String(data.billNo).trim()) {
      const found = one<any>(
        `SELECT id, txn_date, description, amount FROM transactions
          WHERE bill_no = ? AND type = 'Expense' AND id != ? AND (status IS NULL OR status != 'Void')
          ORDER BY id DESC LIMIT 1`,
        [String(data.billNo).trim(), data.id ?? -1]
      );
      if (found) duplicateBill = found;
    }
    // Asset link (V036): an entry can be tagged with the building / land /
    // rentable good it belongs to, so the Assets page can total its income
    // and upkeep. Unknown ids are refused rather than silently dropped.
    let assetId: number | null = null;
    if (data.assetId) {
      const asset = one<any>("SELECT id FROM assets WHERE id = ?", [Number(data.assetId)]);
      if (!asset) throw new Error("The selected asset no longer exists — please pick it again");
      assetId = Number(data.assetId);
    }
    const { id } = run(
      `INSERT INTO transactions
        (txn_date, account_id, type, amount, payment_method, description, linked_module, linked_id, receipt_number, transaction_ref, voucher_no, bill_no, payee, category, asset_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Posted', ?)`,
      [
        data.txnDate || nowDate(), data.accountId ?? 1, data.type,
        data.amount, data.paymentMethod ?? "Cash", data.description ?? "",
        data.linkedModule ?? "", data.linkedId ?? null,
        receipt, data.transactionRef ?? "",
        voucher, data.billNo ? String(data.billNo).trim() : null,
        data.payee ? String(data.payee).trim() : null,
        data.category ? String(data.category).trim() : null,
        assetId,
        data.createdBy ?? 1
      ]
    );
    return { id, receiptNumber: receipt, voucherNo: voucher, duplicateBill };
  },
  update: (id: number, data: any) => {
    const existing = one<any>("SELECT status FROM transactions WHERE id = ?", [id]);
    if (existing?.status === "Void") throw new Error("Voided entries cannot be edited. Enter a new entry instead.");
    let assetId: number | null = null;
    if (data.assetId) {
      const asset = one<any>("SELECT id FROM assets WHERE id = ?", [Number(data.assetId)]);
      if (!asset) throw new Error("The selected asset no longer exists — please pick it again");
      assetId = Number(data.assetId);
    }
    return run(
      `UPDATE transactions SET txn_date = ?, account_id = ?, type = ?, amount = ?, payment_method = ?, description = ?, linked_module = ?, linked_id = ?, transaction_ref = ?, voucher_no = ?, bill_no = ?, payee = ?, category = ?, asset_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.txnDate, data.accountId, data.type, data.amount,
        data.paymentMethod, data.description,
        data.linkedModule ?? "", data.linkedId,
        data.transactionRef,
        data.voucherNo ? String(data.voucherNo).trim() : null,
        data.billNo ? String(data.billNo).trim() : null,
        data.payee ? String(data.payee).trim() : null,
        data.category ? String(data.category).trim() : null,
        assetId,
        id
      ]
    );
  },
  /**
   * VOID instead of delete: the receipt number stays occupied, the entry stays
   * visible (struck through) with who/when/why. An auditor can always see both
   * the original entry and the void reason.
   */
  void: (id: number, reason: string, userId: number) => {
    if (!reason?.trim()) throw new Error("A void reason is required");
    const existing = one<any>("SELECT * FROM transactions WHERE id = ?", [id]);
    if (!existing) throw new Error("Transaction not found");
    if (existing.status === "Void") throw new Error("This entry is already voided");
    run(
      `UPDATE transactions SET status = 'Void', voided_at = datetime('now'), voided_by = ?, void_reason = ?, updated_at = datetime('now') WHERE id = ?`,
      [userId, String(reason).trim(), id]
    );
    return { id, receiptNumber: existing.receipt_number };
  },
  /**
   * Receipt sequence for continuity checks: every receipt number in order,
   * with status (Posted/Void) so an auditor can spot gaps or missing numbers.
   */
  receiptSequence: () => {
    const rows = all<any>(
      `SELECT id, receipt_number, txn_date, type, amount, status, void_reason
       FROM transactions
       WHERE receipt_number LIKE 'TXN-%'
       ORDER BY receipt_number ASC`
    );
    // Flag gaps: consecutive numbers that are missing entirely (only possible
    // if someone edited the DB manually, since deletion is blocked).
    const nums = rows
      .map((r) => parseInt(String(r.receipt_number).replace(/^TXN-/, ""), 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const missing: number[] = [];
    for (let i = 1; i < nums.length; i++) {
      for (let n = nums[i - 1] + 1; n < nums[i]; n++) missing.push(n);
    }
    return { receipts: rows, missing, count: rows.length };
  },
  remove: (id: number) => run("DELETE FROM transactions WHERE id = ?", [id]),
  totalIncome: () => scalar<number>("SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE type = 'Income' AND (status IS NULL OR status != 'Void')"),
  totalExpense: () => scalar<number>("SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE type = 'Expense' AND (status IS NULL OR status != 'Void')"),
  balance: () => scalar<number>("SELECT (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Income' AND (status IS NULL OR status != 'Void')) - (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Expense' AND (status IS NULL OR status != 'Void')) AS v"),

  // ===== Unified ledger — combines manual transactions with auto-entries from
  // donations, subscriptions, welfare disbursements, and staff salary payments.
  // Each row carries a `source` field so the renderer can badge it.
  //
  // Period presets (server-side computed):
  //   all | this_month | last_month | this_quarter | last_quarter | this_year | last_year | custom
  // When period === 'custom', the caller must pass `from` and `to` (YYYY-MM-DD).
  // =================================================================
  _resolvePeriodRange: (period: string, from?: string, to?: string): { from: string; to: string } | null => {
    if (period === "all") return null;
    if (period === "custom") {
      if (!from || !to) return null;
      return { from, to };
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-11
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (period === "this_month") {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    if (period === "last_month") {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      return { from: iso(first), to: iso(last) };
    }
    if (period === "this_quarter") {
      const qStartMonth = Math.floor(m / 3) * 3;
      const first = new Date(y, qStartMonth, 1);
      const last = new Date(y, qStartMonth + 3, 0);
      return { from: iso(first), to: iso(last) };
    }
    if (period === "last_quarter") {
      const qStartMonth = Math.floor(m / 3) * 3 - 3;
      const cy = qStartMonth < 0 ? y - 1 : y;
      const cm = qStartMonth < 0 ? qStartMonth + 12 : qStartMonth;
      const first = new Date(cy, cm, 1);
      const last = new Date(cy, cm + 3, 0);
      return { from: iso(first), to: iso(last) };
    }
    if (period === "this_year") {
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (period === "last_year") {
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    }
    return null;
  },

  unifiedList: (filter: { period?: string; from?: string; to?: string; source?: string; type?: string; search?: string; page?: number; pageSize?: number } = {}) => {
    const range = (accounting as any)._resolvePeriodRange(filter.period || "all", filter.from, filter.to) as { from: string; to: string } | null;
    // Each sub-query projects a uniform row shape: ledger_date, type, amount, source, source_id, description, payment_method, transaction_ref, receipt_number.
    // We use UNION ALL and a synthetic row_number for stable ordering across sources.
    const parts: string[] = [];
    const params: any[] = [];

    // 1. Manual transactions
    {
      const w: string[] = ["1=1"];
      if (range) { w.push("t.txn_date >= ?"); w.push("t.txn_date <= ?"); params.push(range.from, range.to); }
      if (filter.type && filter.type !== "All") { w.push("t.type = ?"); params.push(filter.type); }
      if (filter.search) { w.push("(t.description LIKE ? OR t.receipt_number LIKE ? OR t.transaction_ref LIKE ? OR t.voucher_no LIKE ? OR t.bill_no LIKE ? OR t.category LIKE ? OR a.name LIKE ?)"); const t = `%${filter.search}%`; params.push(t, t, t, t, t, t, t); }
      parts.push(`SELECT t.id AS source_id, 'transactions' AS source, t.txn_date AS ledger_date, t.type, t.amount, t.description, t.payment_method, t.transaction_ref, t.receipt_number, t.account_id, t.linked_module, t.linked_id, t.voucher_no, t.bill_no, t.payee, t.category, t.status, t.void_reason, t.voided_at, a.name AS asset_name,
        CASE WHEN EXISTS(SELECT 1 FROM audit_log al WHERE al.module='accounting' AND al.entity_id=t.id AND al.action IN ('UPDATE','EDIT'))
               OR EXISTS(SELECT 1 FROM record_history rh WHERE rh.entity_type='transaction' AND rh.entity_id=t.id AND rh.action='EDIT')
             THEN 1 ELSE 0 END AS has_history
        FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id WHERE ${w.join(" AND ")}`);
    }
    // 2. Donations (always Income)
    {
      const w: string[] = ["1=1"];
      if (range) { w.push("d.donation_date >= ?"); w.push("d.donation_date <= ?"); params.push(range.from, range.to); }
      if (filter.type && filter.type !== "All" && filter.type !== "Income") { w.push("1=0"); } // donations are income only
      if (filter.search) { w.push("(d.donor_name LIKE ? OR d.receipt_number LIKE ? OR d.purpose LIKE ?)"); const t = `%${filter.search}%`; params.push(t, t, t); }
      parts.push(`SELECT d.id AS source_id, 'donations' AS source, d.donation_date AS ledger_date, 'Income' AS type, d.amount, (d.donor_name || COALESCE(' — ' || d.purpose, '')) AS description, d.payment_method, '' AS transaction_ref, d.receipt_number, NULL AS account_id, NULL AS linked_module, NULL AS linked_id, NULL AS voucher_no, NULL AS bill_no, NULL AS payee, NULL AS category, NULL AS status, NULL AS void_reason, NULL AS voided_at, NULL AS asset_name,
        CASE WHEN EXISTS(SELECT 1 FROM audit_log al WHERE al.module='donations' AND al.entity_id=d.id AND al.action IN ('UPDATE','EDIT')) THEN 1 ELSE 0 END AS has_history
        FROM donations d WHERE ${w.join(" AND ")}`);
    }
    // 3. Subscription payments from the immutable ledger (Income)
    {
      const w: string[] = ["sp.status = 'Active'", "COALESCE(sp.amount, 0) > 0"];
      if (range) { w.push("sp.payment_date >= ?"); w.push("sp.payment_date <= ?"); params.push(range.from, range.to); }
      if (filter.type && filter.type !== "All" && filter.type !== "Income") { w.push("1=0"); }
      if (filter.search) { w.push("(sp.receipt_number LIKE ? OR sp.remarks LIKE ?)"); const t = `%${filter.search}%`; params.push(t, t); }
      parts.push(`SELECT sp.id AS source_id, 'subscriptions' AS source, COALESCE(sp.payment_date, sp.period_start) AS ledger_date, 'Income' AS type, sp.amount, ('Subscription — ' || COALESCE(sp.receipt_number, '')) AS description, sp.payment_method, sp.transaction_ref, sp.receipt_number, NULL AS account_id, NULL AS linked_module, NULL AS linked_id, NULL AS voucher_no, NULL AS bill_no, NULL AS payee, NULL AS category, NULL AS status, NULL AS void_reason, NULL AS voided_at, NULL AS asset_name, 0 AS has_history FROM subscription_payments sp WHERE ${w.join(" AND ")}`);
    }
    // 4. Welfare disbursements (Expense)
    {
      const w: string[] = ["w.status = 'Disbursed'"];
      if (range) { w.push("w.disbursed_date >= ?"); w.push("w.disbursed_date <= ?"); params.push(range.from, range.to); }
      if (filter.type && filter.type !== "All" && filter.type !== "Expense") { w.push("1=0"); }
      if (filter.search) { w.push("(w.applicant_name LIKE ? OR w.request_number LIKE ?)"); const t = `%${filter.search}%`; params.push(t, t); }
      parts.push(`SELECT w.id AS source_id, 'welfare' AS source, COALESCE(w.disbursed_date, w.created_at) AS ledger_date, 'Expense' AS type, w.amount_approved AS amount, ('Welfare — ' || w.applicant_name) AS description, '' AS payment_method, '' AS transaction_ref, w.request_number AS receipt_number, NULL AS account_id, NULL AS linked_module, NULL AS linked_id, NULL AS voucher_no, NULL AS bill_no, NULL AS payee, NULL AS category, NULL AS status, NULL AS void_reason, NULL AS voided_at, NULL AS asset_name, 0 AS has_history FROM welfare_requests w WHERE ${w.join(" AND ")}`);
    }
    // 5. Staff salary payments (Expense, status='Paid')
    {
      const w: string[] = ["sp.status = 'Paid'"];
      if (range) { w.push("sp.payment_date >= ?"); w.push("sp.payment_date <= ?"); params.push(range.from, range.to); }
      if (filter.type && filter.type !== "All" && filter.type !== "Expense") { w.push("1=0"); }
      if (filter.search) { w.push("(s.name LIKE ? OR s.staff_code LIKE ?)"); const t = `%${filter.search}%`; params.push(t, t); }
      parts.push(`SELECT sp.id AS source_id, 'salary' AS source, sp.payment_date AS ledger_date, 'Expense' AS type, sp.amount, ('Salary — ' || s.name || ' (' || printf('%02d', sp.period_month) || '/' || sp.period_year || ')') AS description, sp.payment_method, sp.transaction_ref, '' AS receipt_number, NULL AS account_id, NULL AS linked_module, NULL AS linked_id, NULL AS voucher_no, NULL AS bill_no, NULL AS payee, NULL AS category, NULL AS status, NULL AS void_reason, NULL AS voided_at, NULL AS asset_name, 0 AS has_history FROM staff_payments sp LEFT JOIN staff s ON s.id = sp.staff_id WHERE ${w.join(" AND ")}`);
    }

    // Combine — wrap in a sub-select so we can filter by source + paginate uniformly.
    // Note: better-sqlite3 doesn't support parameterised LIMIT inside a UNION, but
    // the inner UNION has no LIMIT and the outer SELECT does, which is fine.
    const innerSql = parts.join(" UNION ALL ");
    const outerWhere: string[] = ["1=1"];
    if (filter.source && filter.source !== "All") {
      outerWhere.push("source = ?");
      params.push(filter.source);
    }
    const sql = `SELECT * FROM (${innerSql}) AS u WHERE ${outerWhere.join(" AND ")} ORDER BY u.ledger_date DESC, u.source_id DESC`;

    let rows: any[];
    let total: number;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      rows = all<any>(`${sql} LIMIT ? OFFSET ?`, [...params, filter.pageSize, offset]);
      const countRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${innerSql}) AS u WHERE ${outerWhere.join(" AND ")}`, params);
      total = countRow?.c ?? 0;
    } else {
      rows = all<any>(sql, params);
      total = rows.length;
    }
    return { rows, total };
  },

  unifiedSummary: (filter: { period?: string; from?: string; to?: string } = {}) => {
    const range = (accounting as any)._resolvePeriodRange(filter.period || "all", filter.from, filter.to) as { from: string; to: string } | null;

    // Re-use the union from unifiedList but only compute aggregates. We build it
    // inline here (rather than calling unifiedList) so we don't ship all the rows
    // back to the renderer just to sum them.
    const parts: string[] = [];
    {
      const w: string[] = ["(t.status IS NULL OR t.status != 'Void')"];
      if (range) { w.push("t.txn_date >= ?"); w.push("t.txn_date <= ?"); }
      parts.push(`SELECT t.txn_date AS ledger_date, t.type, t.amount, 'transactions' AS source FROM transactions t WHERE ${w.join(" AND ")}`);
    }
    {
      const w: string[] = ["1=1"];
      if (range) { w.push("d.donation_date >= ?"); w.push("d.donation_date <= ?"); }
      parts.push(`SELECT d.donation_date AS ledger_date, 'Income' AS type, d.amount, 'donations' AS source FROM donations d WHERE ${w.join(" AND ")}`);
    }
    {
      const w: string[] = ["sp.status = 'Active'", "COALESCE(sp.amount, 0) > 0"];
      if (range) { w.push("sp.payment_date >= ?"); w.push("sp.payment_date <= ?"); }
      parts.push(`SELECT COALESCE(sp.payment_date, sp.period_start) AS ledger_date, 'Income' AS type, sp.amount, 'subscriptions' AS source FROM subscription_payments sp WHERE ${w.join(" AND ")}`);
    }
    {
      const w: string[] = ["w.status = 'Disbursed'"];
      if (range) { w.push("w.disbursed_date >= ?"); w.push("w.disbursed_date <= ?"); }
      parts.push(`SELECT COALESCE(w.disbursed_date, w.created_at) AS ledger_date, 'Expense' AS type, w.amount_approved AS amount, 'welfare' AS source FROM welfare_requests w WHERE ${w.join(" AND ")}`);
    }
    {
      const w: string[] = ["sp.status = 'Paid'"];
      if (range) { w.push("sp.payment_date >= ?"); w.push("sp.payment_date <= ?"); }
      parts.push(`SELECT sp.payment_date AS ledger_date, 'Expense' AS type, sp.amount, 'salary' AS source FROM staff_payments sp WHERE ${w.join(" AND ")}`);
    }

    const params: any[] = [];
    if (range) { params.push(range.from, range.to); params.push(range.from, range.to); params.push(range.from, range.to); params.push(range.from, range.to); params.push(range.from, range.to); }

    const union = parts.join(" UNION ALL ");
    // BUGFIX: previously the outer SELECT was `FROM (union) AS u ${dateClause}`
    // which produced `FROM (...) AS u AND ledger_date >= ?` — missing the
    // WHERE keyword. SQLite raised: "near \"AND\": syntax error" whenever a
    // period filter was active. Now we always emit `WHERE 1=1` so the optional
    // AND-clause composes cleanly even when there is no period filter.
    const whereClause = range ? "WHERE 1=1 AND ledger_date >= ? AND ledger_date <= ?" : "WHERE 1=1";
    const row = one<any>(
      `SELECT
        COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type='Income' AND source='donations' THEN amount ELSE 0 END), 0) AS income_donations,
        COALESCE(SUM(CASE WHEN type='Income' AND source='subscriptions' THEN amount ELSE 0 END), 0) AS income_subscriptions,
        COALESCE(SUM(CASE WHEN type='Income' AND source='transactions' THEN amount ELSE 0 END), 0) AS income_manual,
        COALESCE(SUM(CASE WHEN type='Expense' AND source='welfare' THEN amount ELSE 0 END), 0) AS expense_welfare,
        COALESCE(SUM(CASE WHEN type='Expense' AND source='salary' THEN amount ELSE 0 END), 0) AS expense_salary,
        COALESCE(SUM(CASE WHEN type='Expense' AND source='transactions' THEN amount ELSE 0 END), 0) AS expense_manual,
        COUNT(*) AS entry_count
       FROM (${union}) AS u ${whereClause}`,
      range ? [...params, range.from, range.to] : params
    );
    return {
      totalIncome: row?.total_income ?? 0,
      totalExpense: row?.total_expense ?? 0,
      balance: (row?.total_income ?? 0) - (row?.total_expense ?? 0),
      incomeDonations: row?.income_donations ?? 0,
      incomeSubscriptions: row?.income_subscriptions ?? 0,
      incomeManual: row?.income_manual ?? 0,
      expenseWelfare: row?.expense_welfare ?? 0,
      expenseSalary: row?.expense_salary ?? 0,
      expenseManual: row?.expense_manual ?? 0,
      entryCount: row?.entry_count ?? 0,
      period: filter.period || "all",
      from: range?.from ?? null,
      to: range?.to ?? null
    };
  },

  /**
   * Double-click preview data for one unified ledger row: the FULL underlying
   * record (whichever module the money came from) plus its change history —
   * structured BEFORE→AFTER field diffs from record_history where available —
   * and the raw audit trail rows, newest first. Salary rows resolve their
   * history against the STAFF id, because salary audit entries are recorded
   * per staff member rather than per payment row.
   */
  unifiedDetail: (source: string, id: number) => {
    const safeId = Number(id) || 0;
    let record: any = null;
    const changes: any[] = [];
    const auditTrail: any[] = [];

    const collectHistory = (entityType: string, entityIds: number[], module: string, moduleIds: number[]) => {
      for (const eid of Array.from(new Set(entityIds.map(Number).filter(Boolean)))) {
        for (const row of all<any>(
          "SELECT * FROM record_history WHERE entity_type = ? AND entity_id = ? ORDER BY changed_at DESC, id DESC",
          [entityType, eid]
        )) changes.push({ ...row });
      }
      for (const mid of Array.from(new Set(moduleIds.map(Number).filter(Boolean)))) {
        for (const row of all<any>(
          "SELECT id, user_id, username, action, module, entity_id, description, metadata, created_at FROM audit_log WHERE module = ? AND entity_id = ? ORDER BY created_at DESC, id DESC",
          [module, mid]
        )) auditTrail.push({ ...row });
      }
    };

    if (source === "transactions" && safeId) {
      record = one<any>(
        `SELECT t.*, u.username AS created_by_name
         FROM transactions t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ?`,
        [safeId]
      );
      collectHistory("transaction", [safeId], "accounting", [safeId]);
    } else if (source === "donations" && safeId) {
      record = one<any>(
        `SELECT d.*, c.name AS category_name, u.username AS received_by_name
         FROM donations d
         LEFT JOIN donation_categories c ON c.id = d.category_id
         LEFT JOIN users u ON u.id = d.received_by
         WHERE d.id = ?`,
        [safeId]
      );
      collectHistory("donation", [safeId], "donations", [safeId]);
    } else if (source === "subscriptions" && safeId) {
      record = one<any>(
        `SELECT sp.*, f.house_name, f.family_number,
           (SELECT m.name FROM members m WHERE m.id = sp.member_id) AS member_name
         FROM subscription_payments sp LEFT JOIN families f ON f.id = sp.family_id
         WHERE sp.id = ?`,
        [safeId]
      );
      // Payment events are audited against BOTH the payment row and the
      // subscription account (recordings/cancellations use the account id).
      collectHistory("subscription_payment", [safeId], "subscriptions", [safeId, Number(record?.subscription_id) || 0]);
    } else if (source === "welfare" && safeId) {
      record = one<any>(
        `SELECT w.*, f.house_name, f.family_number
         FROM welfare_requests w LEFT JOIN families f ON f.id = w.family_id
         WHERE w.id = ?`,
        [safeId]
      );
      collectHistory("welfare", [safeId], "welfare", [safeId]);
    } else if (source === "salary" && safeId) {
      record = one<any>(
        `SELECT sp.*, s.name AS staff_name, s.staff_code
         FROM staff_payments sp LEFT JOIN staff s ON s.id = sp.staff_id
         WHERE sp.id = ?`,
        [safeId]
      );
      collectHistory("staff", [Number(record?.staff_id) || 0], "staff", [Number(record?.staff_id) || 0]);
    }

    return { record, changes, auditTrail };
  },

  /**
   * Annual audit pack for a financial year. The year boundary comes from the
   * Settings "Financial Year Start" value (MM-DD, default 04-01 → 01-Apr to
   * 31-Mar) so masjids whose books close on a different date get a pack that
   * matches their real year.
   * Produces: Receipts & Payments, Income & Expenditure, the 7% Waqf
   * contribution indicator (S.77), and the voucher-indexed transaction
   * listing — everything a Kerala Waqf Board / society auditor asks for.
   */
  auditPack: (fyYear: number) => {
    const fy = Number(fyYear) || new Date().getFullYear();
    // Read the configured FY start (MM-DD). Anything malformed falls back to
    // the Kerala-standard 04-01.
    const cfg = one<any>("SELECT financial_year_start FROM settings WHERE id = 1");
    const raw = String((cfg as any)?.financial_year_start || "").trim();
    const mmdd = /^\d{2}-\d{2}$/.test(raw) ? raw : "04-01";
    const [fmm, fdd] = mmdd.split("-").map(Number);
    const fyStart = `${fy}-${mmdd}`;
    // End = the day BEFORE next year's start date (pure date arithmetic).
    const endDate = new Date(Date.UTC(fy + 1, fmm - 1, fdd));
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const fyEnd = endDate.toISOString().slice(0, 10);
    const s = (sql: string) => scalar<number>(sql) || 0;

    // Opening balance = everything received/spent BEFORE the FY (all sources).
    const opening = s(`SELECT
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Income' AND (status IS NULL OR status != 'Void') AND txn_date < '${fyStart}')
      + (SELECT COALESCE(SUM(amount),0) FROM donations WHERE donation_date < '${fyStart}')
      + (SELECT COALESCE(SUM(amount),0) FROM subscription_payments WHERE status='Active' AND COALESCE(payment_date, period_start) < '${fyStart}')
      - (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Expense' AND (status IS NULL OR status != 'Void') AND txn_date < '${fyStart}')
      - (SELECT COALESCE(SUM(amount_approved),0) FROM welfare_requests WHERE status='Disbursed' AND COALESCE(disbursed_date, created_at) < '${fyStart}')
      - (SELECT COALESCE(SUM(amount),0) FROM staff_payments WHERE status='Paid' AND payment_date < '${fyStart}')`);

    const receipts = {
      donations: s(`SELECT COALESCE(SUM(amount),0) FROM donations WHERE donation_date >= '${fyStart}' AND donation_date <= '${fyEnd}'`),
      subscriptions: s(`SELECT COALESCE(SUM(amount),0) FROM subscription_payments WHERE status='Active' AND COALESCE(payment_date, period_start) >= '${fyStart}' AND COALESCE(payment_date, period_start) <= '${fyEnd}'`),
      manual: s(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Income' AND (status IS NULL OR status != 'Void') AND txn_date >= '${fyStart}' AND txn_date <= '${fyEnd}'`),
    };
    const payments = {
      welfare: s(`SELECT COALESCE(SUM(amount_approved),0) FROM welfare_requests WHERE status='Disbursed' AND COALESCE(disbursed_date, created_at) >= '${fyStart}' AND COALESCE(disbursed_date, created_at) <= '${fyEnd}'`),
      salary: s(`SELECT COALESCE(SUM(amount),0) FROM staff_payments WHERE status='Paid' AND payment_date >= '${fyStart}' AND payment_date <= '${fyEnd}'`),
      manual: s(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='Expense' AND (status IS NULL OR status != 'Void') AND txn_date >= '${fyStart}' AND txn_date <= '${fyEnd}'`),
    };
    const totalReceipts = receipts.donations + receipts.subscriptions + receipts.manual;
    const totalPayments = payments.welfare + payments.salary + payments.manual;
    const closing = opening + totalReceipts - totalPayments;

    // Voucher-indexed transaction listing (manual entries with audit evidence).
    const transactions = all<any>(
      `SELECT txn_date, receipt_number, voucher_no, bill_no, payee, description, type, amount, payment_method, status, void_reason
       FROM transactions
       WHERE txn_date >= ? AND txn_date <= ?
       ORDER BY txn_date ASC, id ASC`,
      [fyStart, fyEnd]
    );

    const settings = one<any>("SELECT mahallu_name, wakf_reg_no, society_reg_no, village, taluk, district, state FROM settings WHERE id = 1") || {};
    return {
      fyLabel: `${fyStart} to ${fyEnd}`,
      fyYear: fy,
      mahalluName: settings.mahallu_name || "Minz Mahallu",
      wakfRegNo: settings.wakf_reg_no || "",
      societyRegNo: settings.society_reg_no || "",
      village: settings.village || "", taluk: settings.taluk || "", district: settings.district || "", state: settings.state || "",
      opening, closing,
      receipts, payments, totalReceipts, totalPayments,
      waqfContribution: Math.round(totalReceipts * 0.07 * 100) / 100,
      transactions,
      generatedAt: new Date().toISOString(),
    };
  },
};
