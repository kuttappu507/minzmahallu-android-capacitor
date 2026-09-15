/* Subscriptions module — split out of data.service.ts (public API unchanged via the facade). */

import { all, getDB, one, run, scalar } from "../../db/connection.js";
import { nextReceiptNumber } from "../doc-number.service.js";
import { istDateStr } from "../ist-date.js";
import { families } from "./families.service.js";
import { nowDate, round2 } from "./shared.js";

// RECURRING MODEL: one subscriptions row per family = the family's subscription
// account, always recorded against the family HEAD. Each month the SAME row is
// rolled over to the new period (amount = configured monthly rate, e.g. 200;
// amount_paid resets to 0) — a new month NEVER creates a new row. Actual money
// movements live in subscription_payments (one record per family per month);
// editing a payment only changes how much was given — family / period / rate
// are locked.

function currentMonthPeriod(): { periodStart: string; periodEnd: string } {
  // First and last day of the CURRENT calendar month as seen in India.
  const ymd = istDateStr(new Date()); // "yyyy-mm-dd" in IST
  const year = ymd.slice(0, 4);
  const month = ymd.slice(5, 7);
  const periodStart = `${year}-${month}-01`;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate(); // days in this month (pure arithmetic)
  const periodEnd = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  return { periodStart, periodEnd };
}

function currentQuarterPeriod(ymd: string): { periodStart: string; periodEnd: string } {
  // Calendar-quarter boundaries (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec) as seen
  // in India — used when Settings → Subscription frequency is "Quarterly".
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1; // 1, 4, 7, 10
  const qEndMonth = qStartMonth + 2; // 3, 6, 9, 12
  const periodStart = `${year}-${String(qStartMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, qEndMonth, 0)).getUTCDate(); // days in the END month
  const periodEnd = `${year}-${String(qEndMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { periodStart, periodEnd };
}

/** The recurring billing period the masjid currently operates on. Reads the
 *  Settings "Subscription frequency" — masjids that collect once a quarter
 *  get a real quarterly account (period covers the whole quarter), everyone
 *  else keeps the classic monthly cycle. */
function currentPeriod(): { periodStart: string; periodEnd: string; frequency: "Monthly" | "Quarterly" } {
  const cfg = one<any>("SELECT subscription_frequency FROM settings WHERE id = 1");
  const frequency = String((cfg as any)?.subscription_frequency || "Monthly") === "Quarterly" ? "Quarterly" : "Monthly";
  const ymd = istDateStr(new Date());
  if (frequency === "Quarterly") return { ...currentQuarterPeriod(ymd), frequency };
  return { ...currentMonthPeriod(), frequency };
}

function familyHeadMemberId(familyId: number): number | null {
  const head = one<any>(
    "SELECT id FROM members WHERE family_id = ? AND archive_state = 0 ORDER BY CASE WHEN is_head = 1 THEN 0 WHEN relationship = 'Head' THEN 1 ELSE 2 END, id LIMIT 1",
    [familyId]
  );
  return head?.id ?? null;
}

export function ensureCurrentMonth() {
  const { periodStart, periodEnd, frequency } = currentPeriod();
  const configured = scalar<number>("SELECT COALESCE(subscription_monthly_amount, 0) FROM settings WHERE id = 1") || 0;
  // Plan follows the configured frequency. NOTE: databases created before the
  // schema fix carry a CHECK constraint that only allows Monthly/Yearly/OneTime
  // plan rows — V021's "Quarterly Subscription" seed was silently swallowed by
  // INSERT OR IGNORE on those. There we fall back to the Monthly plan row: the
  // ACCOUNT still bills with the configured quarterly rate and real quarter
  // period boundaries (period_start/period_end below), the plan row is only
  // descriptive metadata.
  const plan = one<any>(
    "SELECT * FROM subscription_plans WHERE frequency = ? AND is_active = 1 ORDER BY id LIMIT 1",
    [frequency]
  ) || one<any>("SELECT * FROM subscription_plans WHERE frequency = 'Monthly' AND is_active = 1 ORDER BY id LIMIT 1");
  if (!plan || configured <= 0) return { created: 0, rolledOver: 0, amount: configured, periodStart, periodEnd };
  const families = all<any>("SELECT id FROM families WHERE status = 'Active' ORDER BY id");
  let created = 0;
  let rolledOver = 0;
  const db = getDB();
  const tx = db.transaction(() => {
    for (const f of families) {
      const head = familyHeadMemberId(f.id);
      const existing = one<any>(
        "SELECT id, member_id, period_start, amount, amount_paid, arrears, advance FROM subscriptions WHERE family_id = ? LIMIT 1",
        [f.id]
      );
      if (!existing) {
        db.prepare(
          `INSERT INTO subscriptions (family_id, member_id, plan_id, period_start, period_end, amount, amount_paid, status, collected_by, remarks) VALUES (?, ?, ?, ?, ?, ?, 0, 'Pending', NULL, '')`
        ).run(f.id, head, plan.id, periodStart, periodEnd, configured);
        created++;
        continue;
      }
      // Always keep the account pointed at the current head.
      if (head && head !== existing.member_id) {
        db.prepare("UPDATE subscriptions SET member_id = ?, updated_at = datetime('now') WHERE id = ?").run(head, existing.id);
      }
      if (existing.period_start === periodStart) {
        // Same month: adopt a mid-month rate change only while unpaid.
        if (Number(existing.amount_paid || 0) === 0 && Number(existing.amount) !== configured) {
          db.prepare("UPDATE subscriptions SET amount = ?, updated_at = datetime('now') WHERE id = ?").run(configured, existing.id);
        }
        continue;
      }
      // New month → roll the SAME row over (never insert a second row).
      // The closing month's unpaid balance becomes ARREARS (it accumulates
      // month after month — “3 months due” = 3 × rate); a legacy overpaid
      // amount becomes ADVANCE credit that nets against future dues.
      const closingPaid = Number(existing.amount_paid || 0);
      const closingRate = Number(existing.amount || 0);
      let carriedArrears = Number(existing.arrears || 0);
      let carriedAdvance = Number(existing.advance || 0);
      if (closingPaid < closingRate) {
        carriedArrears += closingRate - closingPaid;
        // Standing advance first nets against the fresh arrears (a family
        // that prepaid ₹50 and then missed a ₹50 month owes nothing).
        const offset = Math.min(carriedArrears, carriedAdvance);
        carriedArrears -= offset;
        carriedAdvance -= offset;
      } else if (closingPaid > closingRate) {
        carriedAdvance += closingPaid - closingRate;
      }
      // Safety net: if the closing month was paid through a path that bypassed
      // applyPayment, snapshot it into the payment ledger first.
      if (closingPaid > 0) {
        const paid = one<any>(
          "SELECT id FROM subscription_payments WHERE subscription_id = ? AND period_start = ? LIMIT 1",
          [existing.id, existing.period_start]
        );
        if (!paid) {
          const s = one<any>("SELECT * FROM subscriptions WHERE id = ?", [existing.id]) as any;
          db.prepare(
            `INSERT INTO subscription_payments (subscription_id, family_id, member_id, period_start, period_end, amount, receipt_number, payment_date, payment_method, transaction_ref, collected_by, remarks, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`
          ).run(s.id, s.family_id, s.member_id, s.period_start, s.period_end, s.amount_paid, s.receipt_number, s.payment_date || s.period_start, s.payment_method || 'Cash', s.transaction_ref || '', s.collected_by, s.remarks || '');
        }
      }
      db.prepare(
        `UPDATE subscriptions SET plan_id = ?, period_start = ?, period_end = ?, amount = ?, amount_paid = 0, payment_date = NULL, receipt_number = NULL, status = 'Pending', arrears = ?, advance = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(plan.id, periodStart, periodEnd, configured, carriedArrears, carriedAdvance, existing.id);
      rolledOver++;
    }
  });
  tx();
  return { created, rolledOver, amount: configured, periodStart, periodEnd };
}

function memberSubscriptionBalance(familyId: number) {
  if (!familyId) return 0;
  // TRUE balance = old arrears + the uncovered part of this month − advance
  // credit (the "due 150, paid 200" family shows ₹0 here — their ₹50 is a
  // PREPAYMENT, not a negative due). One row per family, summed defensively.
  return scalar<number>(
    `SELECT COALESCE(SUM(MAX(0, MAX(0, amount - amount_paid) + COALESCE(arrears,0) - COALESCE(advance,0))), 0)
     FROM subscriptions WHERE family_id = ? AND status IN ('Pending','Partial','Overdue')`,
    [familyId]
  ) || 0;
}

export const subscriptions = {
  ensureCurrentMonth: () => ensureCurrentMonth(),
  memberBalance: (familyId: number, _memberId?: number) => memberSubscriptionBalance(familyId),
  list: (filter: { search?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(s.receipt_number LIKE ? OR f.house_name LIKE ? OR f.family_number LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t);
    }
    if (filter.status && filter.status !== "All Status") {
      where.push("s.status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT s.*, f.family_number, f.house_name,
      (SELECT m.name FROM members m WHERE m.id = s.member_id) AS member_name,
      (SELECT sp.receipt_sent_at FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS wa_sent_at,
      (SELECT sp.receipt_delivered_at FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS wa_delivered_at,
      (SELECT sp.receipt_resends FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS wa_resends,
      (SELECT sp.amount FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS month_cash,
      (SELECT sp.arrears_cleared FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS month_arrears_cleared,
      (SELECT sp.advance_added FROM subscription_payments sp WHERE sp.subscription_id = s.id AND sp.period_start = s.period_start AND sp.status = 'Active' LIMIT 1) AS month_advance_added
      FROM subscriptions s LEFT JOIN families f ON f.id = s.family_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.payment_date DESC NULLS LAST, s.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM subscriptions s WHERE ${where.join(" AND ")}`,
        params
      );
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM subscriptions WHERE id = ?", [id]),
  create: (data: any) => {
    // One subscription ACCOUNT per family — the recurring row. If the family
    // already has one, refuse and point the user at the existing row.
    const existing = one<any>("SELECT id, receipt_number FROM subscriptions WHERE family_id = ? LIMIT 1", [data.familyId]);
    if (existing) {
      throw new Error(
        "This family already has a subscription. Open the existing row to record this month's payment — a family has exactly one recurring subscription."
      );
    }
    const { periodStart, periodEnd } = currentPeriod();
    const configured = scalar<number>("SELECT COALESCE(subscription_monthly_amount, 0) FROM settings WHERE id = 1") || 0;
    const firstPayment = Math.max(0, Number(data.amountPaid ?? 0));
    const { id } = run(
      `INSERT INTO subscriptions
        (family_id, member_id, plan_id, period_start, period_end, amount, amount_paid,
         payment_date, receipt_number, payment_method, transaction_ref, status, collected_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, 'Pending', ?, ?)`,
      [
        data.familyId, data.memberId ?? familyHeadMemberId(data.familyId), data.planId ?? 1,
        data.periodStart || periodStart, data.periodEnd || periodEnd,
        data.amount ?? configured,
        data.paymentMethod ?? "Cash", data.transactionRef ?? "",
        data.collectedBy ?? 1, data.remarks ?? ""
      ]
    );
    // A first payment runs through the SAME oldest-first allocation as any
    // other payment (a fresh account has no arrears, so cash above the rate
    // becomes advance credit for coming months — never a paid-ahead month).
    if (firstPayment > 0) {
      return { ...(subscriptions as any).applyPayment(id, data), id };
    }
    return { id, receiptNumber: "" };
  },
  /** Restricted payment edit: ONLY how much was given (plus date/method/ref/
   *  remarks) may change. Family, member, period and the monthly rate are
   *  locked because the subscription is a recurring account.
   *
   *  Cash is applied OLDEST-FIRST: old arrears → this month's rate → any
   *  extra becomes ADVANCE credit for coming months. Re-recording the month
   *  rolls the previous allocation back first (each ledger row remembers how
   *  much of its cash cleared arrears / became advance), so the account is
   *  always exactly "month-start state + this month's cash". Status is Paid
   *  only when the month is covered AND no arrears remain. */
  applyPayment: (id: number, data: any) => {
    const db = getDB();
    const s = one<any>("SELECT * FROM subscriptions WHERE id = ?", [id]);
    if (!s) throw new Error("Subscription not found");
    // Guard against attempts to move the account to another family/period.
    if (data.familyId != null && Number(data.familyId) !== Number(s.family_id)) {
      throw new Error("A subscription cannot be moved to another family. Payment edits only change how much was given.");
    }
    if (data.periodStart && data.periodStart !== s.period_start) {
      throw new Error("The billing period is fixed by the recurring subscription. Payment edits only change how much was given.");
    }
    const cash = Math.max(0, Number(data.amountPaid ?? s.amount_paid ?? 0));
    const rate = Number(s.amount || 0);
    let arrears = Number(s.arrears || 0);
    let advance = Number(s.advance || 0);
    const paymentDate = data.paymentDate || nowDate();
    let txReceipt = "";
    let txStatus = "Pending";
    let txState = { monthTake: 0, arrears, advance, cash };
    const tx = db.transaction(() => {
      // One payment record per subscription per month (upsert).
      const paid = one<any>(
        "SELECT id, receipt_number, amount, arrears_cleared, advance_added FROM subscription_payments WHERE subscription_id = ? AND period_start = ? LIMIT 1",
        [s.id, s.period_start]
      );
      // Roll THIS month's previous allocation back to the month-start state
      // before applying the new cash (re-record / top-up path).
      if (paid) {
        arrears += Number(paid.arrears_cleared || 0);
        advance = Math.max(0, advance - Number(paid.advance_added || 0));
      }
      // A receipt number already issued for this month (printed / sent on
      // WhatsApp) is NEVER renumbered. A fresh month gets a fresh number in
      // the mahallu's subscription receipt series (SB — donations run in
      // their own DN book), never reusing the subscription row's number from
      // a previous month (that legacy reuse was a duplicate-receipt bug).
      const receipt = String(paid?.receipt_number || "").trim() || nextReceiptNumber(paymentDate, "subscription");
      // ---- Oldest-first allocation of the cash given this month ----
      const arrearsTake = Math.min(arrears, cash);            // 1) old dues
      arrears = round2(arrears - arrearsTake);
      const afterArrears = round2(cash - arrearsTake);
      const monthTake = Math.min(rate, afterArrears);        // 2) this month
      const advanceAdded = round2(afterArrears - monthTake); // 3) credit
      advance = round2(advance + advanceAdded);
      const status = cash <= 0 ? "Pending" : arrears <= 0.004 && monthTake >= rate ? "Paid" : "Partial";
      if (paid) {
        db.prepare(
          `UPDATE subscription_payments SET member_id = ?, amount = ?, arrears_cleared = ?, advance_added = ?, receipt_number = ?, payment_date = ?, payment_method = ?, transaction_ref = ?, remarks = ?, status = 'Active', updated_at = datetime('now') WHERE id = ?`
        ).run(s.member_id, cash, arrearsTake, advanceAdded, receipt, paymentDate, data.paymentMethod || "Cash", data.transactionRef ?? "", data.remarks ?? "", paid.id);
      } else {
        db.prepare(
          `INSERT INTO subscription_payments (subscription_id, family_id, member_id, period_start, period_end, amount, arrears_cleared, advance_added, receipt_number, payment_date, payment_method, transaction_ref, collected_by, remarks, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`
        ).run(s.id, s.family_id, s.member_id, s.period_start, s.period_end, cash, arrearsTake, advanceAdded, receipt, paymentDate, data.paymentMethod || "Cash", data.transactionRef ?? "", data.collectedBy ?? 1, data.remarks ?? "");
      }
      // The subscription row mirrors the LATEST month's receipt number for
      // list display and search. amount_paid holds the THIS-MONTH portion of
      // the cash (never above the rate); arrears/advance carry the rest.
      db.prepare(
        `UPDATE subscriptions SET amount_paid = ?, arrears = ?, advance = ?, payment_date = ?, receipt_number = ?, payment_method = ?, transaction_ref = ?, status = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(cash > 0 ? monthTake : 0, arrears, advance, cash > 0 ? paymentDate : null, cash > 0 ? receipt : null, data.paymentMethod || "Cash", data.transactionRef ?? "", status, data.remarks ?? "", id);
      txReceipt = receipt;
      txStatus = status;
      txState = { monthTake, arrears, advance, cash };
    });
    tx();
    // The account's dues after this payment — never negative (an overpaid
    // family is "paid ahead", not "minus pending").
    const dueTotal = Math.max(0, round2(txState.arrears + Math.max(0, rate - txState.monthTake) - txState.advance));
    return { id, receiptNumber: cash > 0 ? txReceipt : "", status: txStatus, amountPaid: cash, monthPaid: txState.monthTake, arrears: round2(txState.arrears), advance: round2(txState.advance), dueTotal };
  },
  /** Cancel the current month's payment (secure action: reason + admin
   *  password are enforced at the IPC layer). Resets the month to unpaid and
   *  marks the ledger record Cancelled — nothing is deleted. */
  cancelPayment: (id: number) => {
    const db = getDB();
    const s = one<any>("SELECT * FROM subscriptions WHERE id = ?", [id]);
    if (!s) throw new Error("Subscription not found");
    const tx = db.transaction(() => {
      // The month's ACTIVE payment (if any) — its allocation must be rolled
      // back exactly: whatever cash it cleared from old arrears goes back to
      // arrears, whatever it parked as advance credit is withdrawn.
      const paid = one<any>(
        "SELECT id, arrears_cleared, advance_added FROM subscription_payments WHERE subscription_id = ? AND period_start = ? AND status = 'Active' LIMIT 1",
        [id, s.period_start]
      );
      const backArrears = Number(paid?.arrears_cleared || 0);
      const backAdvance = Number(paid?.advance_added || 0);
      if (paid) {
        db.prepare(
          "UPDATE subscription_payments SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?"
        ).run(paid.id);
      }
      db.prepare(
        `UPDATE subscriptions SET amount_paid = 0, arrears = MAX(0, COALESCE(arrears,0) + ?), advance = MAX(0, COALESCE(advance,0) - ?), payment_date = NULL, receipt_number = NULL, status = 'Pending', updated_at = datetime('now') WHERE id = ?`
      ).run(backArrears, backAdvance, id);
    });
    tx();
    return { id };
  },
  /** Monthly payment history of a family (from the immutable ledger). */
  paymentsHistory: (familyId: number, limit = 60) =>
    all<any>(
      `SELECT sp.*, f.family_number, f.house_name,
        (SELECT m.name FROM members m WHERE m.id = sp.member_id) AS member_name
       FROM subscription_payments sp LEFT JOIN families f ON f.id = sp.family_id
       WHERE sp.family_id = ?
       ORDER BY COALESCE(sp.period_start, '') DESC, sp.id DESC LIMIT ?`,
      [familyId, limit]
    ),
  update: (id: number, data: any) => {
    // Legacy full-row update is retired for recurring subscriptions — the
    // only permitted edit is recording/correcting the payment amount.
    return (subscriptions as any).applyPayment(id, data);
  },
  remove: (id: number) => run("DELETE FROM subscriptions WHERE id = ?", [id]),
  markOverdue: () => {
    // Accounts are rolled to the CURRENT month by ensureCurrentMonth, so the
    // old "period_end < today" rule could never fire — the button did
    // nothing. A family is overdue when its account carries past-month debt
    // (arrears > 0 — the "N months due (incl. old)" stack), so flag those;
    // recording a payment re-computes the status and clears the flag when
    // the backlog is gone.
    return run(
      `UPDATE subscriptions SET status = 'Overdue', updated_at = datetime('now')
       WHERE status IN ('Pending','Partial') AND COALESCE(arrears,0) > 0.004`,
      []
    ).changes;
  },
  totalCollected: () => scalar<number>("SELECT COALESCE(SUM(amount),0) AS v FROM subscription_payments WHERE status = 'Active'"),
  // TRUE pending across every account: old arrears + this month's uncovered
  // rate − that family's own advance (per-family clamp at 0, so one family's
  // prepayment never erases another family's dues).
  totalPending: () => scalar<number>(`SELECT COALESCE(SUM(MAX(0, MAX(0, amount - amount_paid) + COALESCE(arrears,0) - COALESCE(advance,0))), 0) AS v FROM subscriptions WHERE status IN ('Pending','Partial','Overdue')`),
  plans: () => all<any>("SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY name"),
};
