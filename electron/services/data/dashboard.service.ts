/* Dashboard module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, scalar } from "../../db/connection.js";
import { istMonth, istPlusDays, todayIST } from "../ist-date.js";
import { accounting } from "./accounting.service.js";

export const dashboard = {
  summary: () => {
    const row = one<any>("SELECT * FROM v_dashboard_summary");
    return row ?? {};
  },
  incomeThisMonth: () => scalar<number>("SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE type='Income' AND (status IS NULL OR status != 'Void') AND strftime('%Y-%m', txn_date) = ?", [istMonth()]),
  expenseThisMonth: () => scalar<number>("SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE type='Expense' AND (status IS NULL OR status != 'Void') AND strftime('%Y-%m', txn_date) = ?", [istMonth()]),
  // Fund balance now uses the SAME unified ledger as the Accounting page
  // (manual transactions + donations + paid subscriptions + welfare
  // disbursements + paid salaries). Previously this summed the transactions
  // table only, so the dashboard card disagreed with the Accounting balance.
  balance: () => accounting.unifiedSummary({ period: "all" }).balance,
  monthlyCollections: (months: number = 6) => all<any>(
    // Recursive month series so the chart shows a continuous X axis with
    // zero-filled months instead of only months that happen to have rows.
    `WITH RECURSIVE months(m) AS (
       SELECT strftime('%Y-%m', date(?, ?))
       UNION ALL
       SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < ?
     )
     SELECT m AS month,
       COALESCE((SELECT SUM(amount) FROM subscription_payments WHERE status='Active' AND amount > 0 AND strftime('%Y-%m', payment_date) = m), 0) AS amount
     FROM months ORDER BY m`,
    [todayIST(), `-${months - 1} months`, istMonth()]
  ),
  monthlyDonations: (months: number = 6) => all<any>(
    `WITH RECURSIVE months(m) AS (
       SELECT strftime('%Y-%m', date(?, ?))
       UNION ALL
       SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < ?
     )
     SELECT m AS month,
       COALESCE((SELECT SUM(amount) FROM donations WHERE strftime('%Y-%m', donation_date) = m), 0) AS amount
     FROM months ORDER BY m`,
    [todayIST(), `-${months - 1} months`, istMonth()]
  ),
  // Income vs Expense chart — uses the SAME unified ledger as the Accounting
  // page (manual transactions + donations + paid subscriptions + welfare
  // disbursements + paid salaries). Previously this summed the transactions
  // table only, so the chart disagreed with the Accounting page whenever a
  // donation / subscription / welfare / salary entry existed.
  incomeVsExpense: (months: number = 6) => all<any>(
    `WITH RECURSIVE months(m) AS (
       SELECT strftime('%Y-%m', date(?, ?))
       UNION ALL
       SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < ?
     )
     SELECT m AS month,
       COALESCE((SELECT SUM(amount) FROM transactions WHERE type='Income' AND (status IS NULL OR status != 'Void') AND strftime('%Y-%m', txn_date) = m), 0)
         + COALESCE((SELECT SUM(amount) FROM donations WHERE strftime('%Y-%m', donation_date) = m), 0)
         + COALESCE((SELECT SUM(amount) FROM subscription_payments WHERE status='Active' AND amount > 0 AND strftime('%Y-%m', COALESCE(payment_date, period_start)) = m), 0)
       AS income,
       COALESCE((SELECT SUM(amount) FROM transactions WHERE type='Expense' AND (status IS NULL OR status != 'Void') AND strftime('%Y-%m', txn_date) = m), 0)
         + COALESCE((SELECT SUM(amount_approved) FROM welfare_requests WHERE status='Disbursed' AND strftime('%Y-%m', COALESCE(disbursed_date, created_at)) = m), 0)
         + COALESCE((SELECT SUM(amount) FROM staff_payments WHERE status='Paid' AND strftime('%Y-%m', payment_date) = m), 0)
       AS expense
     FROM months ORDER BY m`,
    [todayIST(), `-${months - 1} months`, istMonth()]
  ),
  recentActivity: (limit: number = 10) => all<any>(
    `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`, [limit]
  ),

  // Real data for the "Today at a Glance" card (no more hardcoded values).
  todayAtGlance: () => {
    const receiptsToday = scalar<number>(
      `SELECT (SELECT COUNT(*) FROM subscription_payments WHERE status='Active' AND amount > 0 AND date(payment_date) = ?)
       + (SELECT COUNT(*) FROM donations WHERE date(donation_date) = ?) AS v`,
      [todayIST(), todayIST()]
    ) || 0;
    const donationsToday = scalar<number>(
      `SELECT COALESCE(SUM(amount),0) FROM donations WHERE date(donation_date) = ?`,
      [todayIST()]
    ) || 0;
    const welfarePending = scalar<number>(
      `SELECT COUNT(*) FROM welfare_requests WHERE status = 'Pending'`
    ) || 0;
    const fundBalance = accounting.unifiedSummary({ period: "all" }).balance;
    return { receiptsToday, donationsToday, welfarePending, fundBalance };
  },

  // Alerts: committee terms ending soon, overdue subs count, pending welfare
  alerts: () => {
    const alerts: any[] = [];
    try {
      // Committee terms ending within 30 days
      const endingSoon = scalar<number>(
        `SELECT COUNT(*) AS v FROM committee_members
         WHERE archive_state = 0 AND status = 'Active' AND term_end IS NOT NULL
           AND term_end >= ? AND term_end <= ?`, [todayIST(), istPlusDays(30)]
      );
      if (endingSoon > 0) alerts.push({ type: "committee_ending", count: endingSoon, route: "/committee" });

      // Overdue subscriptions
      const overdueSubs = scalar<number>(
        `SELECT COUNT(*) AS v FROM subscriptions WHERE status = 'Overdue'`, []
      );
      if (overdueSubs > 0) alerts.push({ type: "subscriptions_overdue", count: overdueSubs, route: "/subscriptions" });

      // Pending welfare requests
      const pendingWelfare = scalar<number>(
        `SELECT COUNT(*) AS v FROM welfare_requests WHERE status = 'Pending'`, []
      );
      if (pendingWelfare > 0) alerts.push({ type: "welfare_pending", count: pendingWelfare, route: "/welfare" });

      // Receipt sequence gaps — deletion is blocked in-app, so gaps can only
      // mean manual DB tampering; surface it right on the dashboard.
      try {
        const seq = accounting.receiptSequence();
        if (seq.missing.length > 0) {
          alerts.push({ type: "receipt_gaps", count: seq.missing.length, missing: seq.missing, route: "/accounting" });
        }
      } catch { /* non-fatal */ }
    } catch (e) { console.warn("[alerts] Failed:", e); }
    return alerts;
  },
};
